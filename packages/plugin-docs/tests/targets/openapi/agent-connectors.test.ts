import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../../../src/targets/openapi/codegen.js';
import type { OpenApiConfig } from '../../../src/targets/openapi/codegen.js';
import { contractRoot, field, model, opOperation, opRequest, opResponse, opRoot, opRoute, refType, scalarType } from '../../helpers.js';

type Operation = { security?: unknown; tags?: string[]; 'x-mcp-annotations'?: unknown };

const contractRoots = [
    contractRoot([
        model('Role', [field('id', scalarType('uuid'))]),
        model('Secret', [field('value', scalarType('string'))]),
        model('Query', [field('q', scalarType('string'))]),
    ]),
];

const roles = opRoot(
    [
        opRoute('/hiring/roles', [
            opOperation('get', { responses: [opResponse(200, refType('Role'))] }),
            opOperation('post', { request: opRequest('Role'), responses: [opResponse(201, refType('Role'))] }),
        ]),
        // A POST that only searches, declared read-only for MCP.
        opRoute('/hiring/roles/search', [
            opOperation('post', {
                mcp: { readOnlyHint: true, loc: { file: 'roles.ck', line: 1 } },
                request: opRequest('Query'),
                responses: [opResponse(200, refType('Role'))],
            }),
        ]),
    ],
    'roles.ck',
    { area: 'hiring' },
);

const auth = opRoot(
    [
        opRoute('/auth/recovery-codes', [opOperation('post', { mcp: 'exclude', responses: [opResponse(201, refType('Secret'))] })]),
        opRoute('/health', [opOperation('get', { security: 'none', responses: [opResponse(204)] })]),
    ],
    'auth.ck',
    { area: 'auth' },
);

const build = (config: OpenApiConfig) => buildOpenApiDocument({ contractRoots, opRoots: [roles, auth], config });
const operation = (doc: Record<string, unknown>, path: string, method: string): Operation =>
    (doc.paths as Record<string, Record<string, Operation>>)[path]![method]!;

describe('OpenAPI for agent connectors', () => {
    describe('omitMcpExcluded', () => {
        it('leaves out mcp: exclude operations and the schemas only they reach', () => {
            const doc = build({ omitMcpExcluded: true });
            expect(Object.keys(doc.paths as object)).not.toContain('/auth/recovery-codes');
            expect(Object.keys((doc.components as { schemas: object }).schemas)).not.toContain('Secret');
        });

        it('keeps them by default', () => {
            expect(Object.keys(build({}).paths as object)).toContain('/auth/recovery-codes');
        });
    });

    describe('tags', () => {
        it('tags each operation with its file’s area and lists the areas in first-seen order', () => {
            const doc = build({ tags: true });
            expect(operation(doc, '/hiring/roles', 'get').tags).toEqual(['hiring']);
            expect(operation(doc, '/health', 'get').tags).toEqual(['auth']);
            expect(doc.tags).toEqual([{ name: 'hiring' }, { name: 'auth' }]);
        });

        it('adds no tags unless asked', () => {
            const doc = build({});
            expect(doc.tags).toBeUndefined();
            expect(operation(doc, '/hiring/roles', 'get').tags).toBeUndefined();
        });

        it('skips files with no area', () => {
            const doc = buildOpenApiDocument({ contractRoots, opRoots: [opRoot([opRoute('/x', [opOperation('get')])])], config: { tags: true } });
            expect(doc.tags).toBeUndefined();
            expect(operation(doc, '/x', 'get').tags).toBeUndefined();
        });
    });

    describe('operationSecurity', () => {
        const operationSecurity = { read: [{ oauth: ['api.read'] }], write: [{ oauth: ['api.write'] }] };

        it('gives a read the read scopes and a write the write scopes', () => {
            const doc = build({ operationSecurity });
            expect(operation(doc, '/hiring/roles', 'get').security).toEqual([{ oauth: ['api.read'] }]);
            expect(operation(doc, '/hiring/roles', 'post').security).toEqual([{ oauth: ['api.write'] }]);
        });

        it('follows the mcp readOnly hint over the method', () => {
            expect(operation(build({ operationSecurity }), '/hiring/roles/search', 'post').security).toEqual([{ oauth: ['api.read'] }]);
        });

        it('keeps a security: none operation public', () => {
            expect(operation(build({ operationSecurity }), '/health', 'get').security).toEqual([]);
        });

        it('leaves authenticated operations on the global security without it', () => {
            expect(operation(build({}), '/hiring/roles', 'get').security).toBeUndefined();
        });
    });

    describe('mcpAnnotations', () => {
        it('reports the four MCP hints on every operation', () => {
            const doc = build({ mcpAnnotations: true });
            expect(operation(doc, '/hiring/roles/search', 'post')['x-mcp-annotations']).toEqual({
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: false,
                openWorldHint: false,
            });
        });

        it('adds nothing unless asked', () => {
            expect(operation(build({}), '/hiring/roles', 'get')['x-mcp-annotations']).toBeUndefined();
        });
    });
});
