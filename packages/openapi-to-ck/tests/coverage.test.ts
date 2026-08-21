import { describe, it, expect } from 'vitest';
import { convertAndParse, onlyOperation, responseFor } from './helpers.js';
import { schemaToTypeNode } from '../src/schema-to-ast.js';
import { WarningCollector } from '../src/warnings.js';
import type { SchemaContext } from '../src/schema-to-ast.js';

function schemaCtx(warnings = new WarningCollector()): SchemaContext {
    return { circularRefs: new Set(), warnings, path: '#/x', includeComments: true, namedSchemas: {}, extractedModels: [], inlineCounter: 0, insideModel: true };
}

const spec = (pathItem: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    openapi: '3.1.0',
    info: { title: 'T', version: '1.0' },
    paths: { '/pets': pathItem },
    ...extra,
});

const ok = { '200': { description: 'ok' } };

describe('operation name', () => {
    it('takes `name:` from summary, keeping description as the doc comment', async () => {
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'listPets', summary: 'List every pet', description: 'Long prose.', responses: ok } }),
        });
        const op = onlyOperation(root);
        expect(op.name).toBe('List every pet');
        expect(op.sdk).toBe('listPets');
        expect(op.description).toBe('Long prose.');
    });

    it('sanitizes a summary that `nameText` could not carry', async () => {
        // `nameText` runs to end of line and stops at `}` or a whitespace-preceded `#`. An
        // unsanitized summary would close the operation block early and mis-parse the rest.
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'x', summary: 'Close } the brace\nand # comment', responses: ok } }),
        });
        expect(onlyOperation(root).name).toBe('Close the brace and comment');
    });
});

describe('request content types', () => {
    it('keeps a content type outside the three that used to be allowed', async () => {
        const { root } = await convertAndParse({
            input: spec({
                post: {
                    operationId: 'upload',
                    requestBody: { content: { 'text/csv': { schema: { type: 'string' } }, 'application/vnd.api+json': { schema: { type: 'object', properties: { a: { type: 'string' } } } } } },
                    responses: ok,
                },
            }),
        });
        expect(onlyOperation(root).request!.bodies.map(b => b.contentType)).toEqual(['text/csv', 'application/vnd.api+json']);
    });

    it('warns and skips a mime the grammar cannot express', async () => {
        const { warnings } = await convertAndParse({
            input: spec({
                post: { operationId: 'upload', requestBody: { content: { 'text/plain; charset=utf-8': { schema: { type: 'string' } } } }, responses: ok },
            }),
        });
        expect(warnings.some(w => w.message.includes('not a plain type/subtype'))).toBe(true);
    });
});

describe('warnings for constructs with no .ck equivalent', () => {
    it('warns on head/options/trace rather than dropping them silently', async () => {
        const { warnings } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: ok }, head: { responses: ok }, trace: { responses: ok } }),
        });
        expect(warnings.some(w => w.message.includes('`head` operations'))).toBe(true);
        expect(warnings.some(w => w.message.includes('`trace` operations'))).toBe(true);
    });

    it('warns on a non-numeric response key', async () => {
        const { warnings } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: { ...ok, default: { description: 'fallback' }, '4XX': { description: 'client' } } } }),
        });
        expect(warnings.some(w => w.message.includes("'default' is not a numeric status code"))).toBe(true);
        expect(warnings.some(w => w.message.includes("'4XX' is not a numeric status code"))).toBe(true);
    });

    it('warns on a cookie parameter', async () => {
        const { warnings } = await convertAndParse({
            input: spec({ get: { operationId: 'x', parameters: [{ name: 'sid', in: 'cookie', schema: { type: 'string' } }], responses: ok } }),
        });
        expect(warnings.some(w => w.message.includes('cookie parameters'))).toBe(true);
    });

    it('warns on numeric constraints `.ck` cannot express', () => {
        const warnings = new WarningCollector();
        schemaToTypeNode({ type: 'integer', exclusiveMinimum: 0, multipleOf: 5 }, schemaCtx(warnings));
        expect(warnings.warnings.map(w => w.message)).toEqual([
            expect.stringContaining('exclusiveMinimum'),
            expect.stringContaining('multipleOf'),
        ]);
    });
});

describe('schema coverage', () => {
    it('maps duration and the uri/email format aliases', () => {
        const ctx = schemaCtx();
        expect(schemaToTypeNode({ type: 'string', format: 'duration' }, ctx)).toEqual({ kind: 'scalar', name: 'duration' });
        expect(schemaToTypeNode({ type: 'string', format: 'idn-email' }, ctx)).toEqual({ kind: 'scalar', name: 'email' });
        expect(schemaToTypeNode({ type: 'string', format: 'uri-reference' }, ctx)).toEqual({ kind: 'scalar', name: 'url' });
    });

    it('imports additionalProperties: true as mode(loose)', async () => {
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: ok } }, {
                components: { schemas: { Bag: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: true } } },
            }),
        });
        expect(root.models.find(m => m.name === 'Bag')!.mode).toBe('loose');
    });

    it('leaves additionalProperties: false at the strict default', async () => {
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: ok } }, {
                components: { schemas: { Sealed: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false } } },
            }),
        });
        expect(root.models.find(m => m.name === 'Sealed')!.mode).toBeUndefined();
    });
});

describe('spec-level security', () => {
    // `.ck` treats an absent security block as "secured, default policy", so a non-empty OpenAPI
    // requirement is the default and prints nothing. The case that carries information is the
    // opposite one: a spec that is globally *unsecured*, which used to be dropped because
    // `globalSecurity` was collected and never read.
    it('applies a spec-level `security: []` to an operation that does not override it', async () => {
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: ok }, post: { operationId: 'y', security: [{ apiKey: [] }], responses: ok } }, {
                security: [],
                components: { securitySchemes: { apiKey: { type: 'apiKey', name: 'k', in: 'header' } } },
            }),
        });
        const [get, post] = root.routes[0]!.operations;
        expect(get!.security).toBe('none');
        expect(post!.security).toBeUndefined();
    });
});

describe('schema name sanitization', () => {
    it('prefixes a name that would start with a digit', async () => {
        // `identStart` excludes digits, so "3DModel" would otherwise emit a name the parser rejects.
        const { root } = await convertAndParse({
            input: spec({ get: { operationId: 'x', responses: ok } }, {
                components: { schemas: { '3DModel': { type: 'object', properties: { id: { type: 'string' } } } } },
            }),
        });
        expect(root.models.map(m => m.name)).toContain('_3DModel');
    });
});

describe('tag splitting', () => {
    it('files a model reached only from a query param under its own tag', async () => {
        // `collectParamSourceRefs` was written against the pre-tagged-union `ParamSource`, so a
        // `kind: 'params'` source collected nothing and the model fell through to shared.ck.
        const result = await (await import('../src/convert.js')).convertOpenApiToCk({
            input: {
                openapi: '3.1.0',
                info: { title: 'T', version: '1.0' },
                paths: {
                    '/pets': {
                        get: {
                            operationId: 'listPets',
                            tags: ['pets'],
                            parameters: [{ name: 'filter', in: 'query', schema: { $ref: '#/components/schemas/PetFilter' } }],
                            responses: ok,
                        },
                    },
                },
                components: { schemas: { PetFilter: { type: 'object', properties: { status: { type: 'string' } } } } },
            },
            split: 'by-tag',
        });
        expect(result.files.get('pets.ck')).toContain('contract PetFilter:');
        expect(result.files.has('shared.ck')).toBe(false);
    });
});

describe('lazy() placement', () => {
    const recursive = {
        components: {
            schemas: {
                TreeNode: {
                    type: 'object',
                    properties: { id: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } } },
                },
            },
        },
    };

    it('wraps a self-reference inside the contract, but not the response body naming it', async () => {
        const { root, ck } = await convertAndParse({
            input: spec({
                get: {
                    operationId: 'getTree',
                    responses: { '200': { description: 'ok', content: { 'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } } } } },
                },
            }, recursive),
        });

        // Inside the contract the cycle is real and `topoSortModels` cannot order it.
        const children = root.models.find(m => m.name === 'TreeNode')!.fields.find(f => f.name === 'children')!;
        expect(children.type).toEqual({ kind: 'array', item: { kind: 'lazy', inner: { kind: 'ref', name: 'TreeNode' } } });

        // In the operation the model is already imported and evaluated.
        expect(responseFor(onlyOperation(root), 200).bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'TreeNode' });
        expect(ck).toContain('application/json: TreeNode');
    });

    it('leaves request bodies, params and response headers bare too', async () => {
        const { root } = await convertAndParse({
            input: spec({
                post: {
                    operationId: 'putTree',
                    parameters: [{ name: 'filter', in: 'query', schema: { $ref: '#/components/schemas/TreeNode' } }],
                    requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } } } },
                    responses: ok,
                },
            }, recursive),
        });
        const op = onlyOperation(root);
        expect(op.request!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'TreeNode' });
        expect((op.query as { kind: 'params'; nodes: { type: unknown }[] }).nodes[0]!.type).toEqual({ kind: 'ref', name: 'TreeNode' });
    });

    it('still wraps inside a model extracted from an inline body schema', async () => {
        // The extracted model is a contract body like any other.
        const { root } = await convertAndParse({
            input: spec({
                post: {
                    operationId: 'putTree',
                    requestBody: {
                        content: { 'application/json': { schema: { type: 'object', properties: { root: { $ref: '#/components/schemas/TreeNode' } } } } },
                    },
                    responses: ok,
                },
            }, recursive),
        });
        const extracted = root.models.find(m => m.name === 'PutTreeRequest')!;
        expect(extracted.fields.find(f => f.name === 'root')!.type).toEqual({ kind: 'lazy', inner: { kind: 'ref', name: 'TreeNode' } });
    });
});
