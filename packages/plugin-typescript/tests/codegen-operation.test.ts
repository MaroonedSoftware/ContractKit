import { describe, it, expect } from 'vitest';
import { generateOp } from '../src/codegen-operation.js';
import { SECURITY_NONE } from '@contractkit/core';
import {
    scalarType,
    arrayType,
    refType,
    inlineObjectType,
    field,
    opParam,
    opRequest,
    opMultiRequest,
    opResponse,
    opResponseMulti,
    opOperation,
    opRoute,
    opRoot,
} from './helpers.js';

describe('generateOperation', () => {
    // ─── Router name derivation ─────────────────────────────────────

    describe('router naming', () => {
        it('derives router name from file path', () => {
            const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
            const output = generateOp(root);
            expect(output).toContain('export const UsersRouter = ServerKitRouter();');
        });

        it('derives PascalCase name from dotted file', () => {
            const root = opRoot([opRoute('/categories', [opOperation('get')])], 'ledger.categories.op');
            const output = generateOp(root);
            expect(output).toContain('export const LedgerCategoriesRouter = ServerKitRouter();');
        });
    });

    // ─── Imports ───────────────────────────────────────────────────

    describe('imports', () => {
        it('generates zod import when inline params are used', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).toContain("import { z } from 'zod';");
        });

        it('omits zod import when no inline schemas are generated', () => {
            const root = opRoot([opRoute('/x', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).not.toContain("import { z } from 'zod';");
        });

        it('generates ServerKitRouter import', () => {
            const root = opRoot([opRoute('/x', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).toContain('ServerKitRouter');
        });

        it('generates type imports when response references models', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const output = generateOp(root);
            expect(output).toContain('User');
        });

        it('generates parseAndValidate import when route has params', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate');
        });

        it('generates parseAndValidate import when route has request body', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate');
        });

        it('omits parseAndValidate when no validation needed', () => {
            const root = opRoot([opRoute('/health', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).not.toContain('parseAndValidate');
        });

        it('includes luxon DateTime import when query uses datetime type', () => {
            const root = opRoot([
                opRoute('/events', [
                    opOperation('get', {
                        query: [opParam('since', scalarType('datetime'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain("import { DateTime } from 'luxon';");
        });

        it('includes luxon DateTime import when inline param uses date type', () => {
            const root = opRoot([opRoute('/events/{date}', [opOperation('get')], [opParam('date', scalarType('date'))])]);
            const output = generateOp(root);
            expect(output).toContain("import { DateTime } from 'luxon';");
        });

        it('omits luxon DateTime import when no date/datetime types used', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).not.toContain('luxon');
        });

        // Every conditional import must be justified by a reference in the generated body —
        // an unused import trips `noUnusedLocals` and lint in the consuming project.
        it('imports bodyParserMiddleware only when an operation has a request body', () => {
            const withBody = generateOp(opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]));
            expect(withBody).toContain('bodyParserMiddleware');

            const withoutBody = generateOp(opRoot([opRoute('/users', [opOperation('get')])]));
            expect(withoutBody).not.toContain('bodyParserMiddleware');
        });

        it('omits MultipartBody when a multipart body shares its shape with the other MIME types', () => {
            // Structurally equal bodies collapse to a single parseAndValidate call, so nothing
            // references MultipartBody even though the operation does declare multipart.
            const root = opRoot([
                opRoute('/upload', [
                    opOperation('post', {
                        request: opMultiRequest([
                            ['multipart/form-data', 'UploadForm'],
                            ['application/json', 'UploadForm'],
                        ]),
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).not.toContain('MultipartBody');
        });

        it('imports MultipartBody when the multipart body is handled on its own', () => {
            const root = opRoot([opRoute('/upload', [opOperation('post', { request: opMultiRequest([['multipart/form-data', 'UploadForm']]) })])]);
            expect(generateOp(root)).toContain("import { MultipartBody } from '@maroonedsoftware/multipart';");
        });

        it('leaves no import unreferenced in the generated body', () => {
            const root = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', { security: SECURITY_NONE }),
                        opOperation('post', { request: opRequest('CreateUser'), signature: 'webhookKey' }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const output = generateOp(root);
            const importLines = output.split('\n').filter(l => l.startsWith('import '));
            expect(importLines.length).toBeGreaterThan(0);

            const bodyText = output
                .split('\n')
                .filter(l => !l.startsWith('import '))
                .join('\n');
            for (const line of importLines) {
                const named = line.match(/^import \{([^}]*)\}/);
                if (!named) continue;
                for (const symbol of named[1]!.split(',').map(s => s.trim().replace(/^type /, ''))) {
                    expect(bodyText, `${symbol} is imported but never used`).toMatch(new RegExp(`\\b${symbol}\\b`));
                }
            }
        });
    });

    // ─── Handler signature ─────────────────────────────────────────

    describe('handler signature', () => {
        it('emits a single-parameter handler without the unused next argument', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { security: SECURITY_NONE })])]);
            const output = generateOp(root);
            expect(output).toContain(".get('/users', async ctx => {");
            expect(output).not.toContain('ctx, next');
        });

        it('omits next on handlers that carry middleware', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateOp(root);
            expect(output).toContain('async ctx => {');
            expect(output).not.toContain('ctx, next');
        });
    });

    // ─── Handler generation — GET ──────────────────────────────────

    describe('GET handlers', () => {
        it('generates list service method for GET without path params', () => {
            const root = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).toContain(".get('/users'");
            expect(output).toContain('service.list(');
        });

        it('generates getById service method for GET with path params', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).toContain('service.getById(');
        });
    });

    // ─── Handler generation — POST ─────────────────────────────────

    describe('POST handlers', () => {
        it('generates POST with body parser middleware', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateOp(root);
            expect(output).toContain("bodyParserMiddleware(['json'])");
        });

        it('generates body validation with parseAndValidate', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate(ctx.parsedBody, CreateUser)');
        });

        it('generates create service method for POST', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateOp(root);
            expect(output).toContain('service.create(');
        });
    });

    // ─── Multi-MIME request bodies ─────────────────────────────────

    describe('multi-MIME request bodies', () => {
        it('emits union of body parser tokens', () => {
            const root = opRoot([
                opRoute('/auth/token', [
                    opOperation('post', {
                        request: opMultiRequest([
                            ['application/json', 'AuthRequest'],
                            ['application/x-www-form-urlencoded', 'AuthRequest'],
                        ]),
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain("bodyParserMiddleware(['json', 'urlencoded'])");
        });

        it('collapses to a single parseAndValidate when body shapes are structurally equal', () => {
            const root = opRoot([
                opRoute('/auth/token', [
                    opOperation('post', {
                        request: opMultiRequest([
                            ['application/json', 'AuthRequest'],
                            ['application/x-www-form-urlencoded', 'AuthRequest'],
                        ]),
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('const body = await parseAndValidate(ctx.parsedBody, AuthRequest)');
            expect(output).not.toContain('switch (ctx.request.type)');
        });

        it('emits switch on ctx.request.type when body shapes differ', () => {
            const root = opRoot([
                opRoute('/uploads', [
                    opOperation('post', {
                        request: opMultiRequest([
                            ['application/json', 'UploadMeta'],
                            ['multipart/form-data', 'UploadFile'],
                        ]),
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('switch (ctx.request.type)');
            expect(output).toContain("case 'application/json':");
            expect(output).toContain("case 'multipart/form-data':");
            expect(output).toContain('body = ctx.parsedBody as MultipartBody;');
            expect(output).toContain('body = await parseAndValidate(ctx.parsedBody, UploadMeta)');
            expect(output).toContain("import { MultipartBody } from '@maroonedsoftware/multipart';");
        });
    });

    // ─── Handler generation — PUT/PATCH/DELETE ─────────────────────

    describe('PUT/PATCH/DELETE handlers', () => {
        it('generates replace for PUT', () => {
            const root = opRoot([opRoute('/users', [opOperation('put')])]);
            const output = generateOp(root);
            expect(output).toContain('service.replace(');
        });

        it('generates update for PATCH', () => {
            const root = opRoot([opRoute('/users', [opOperation('patch')])]);
            const output = generateOp(root);
            expect(output).toContain('service.update(');
        });

        it('generates delete for DELETE', () => {
            const root = opRoot([opRoute('/users', [opOperation('delete')])]);
            const output = generateOp(root);
            expect(output).toContain('service.delete(');
        });
    });

    // ─── Params validation ────────────────────────────────────────

    describe('params validation', () => {
        it('generates params validation block', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate(');
            expect(output).toContain('ctx.params');
            expect(output).toContain('z.strictObject({');
            expect(output).toContain('id: z.uuid()');
        });

        it('renders param types correctly', () => {
            const root = opRoot([opRoute('/items/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOp(root);
            expect(output).toContain('id: z.uuid()');
        });

        it('generates type-reference params validation', () => {
            const root = opRoot([opRoute('/users/{id}', [opOperation('get')], 'RouteParams')]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate(ctx.params, RouteParams.strict())');
        });
    });

    // ─── Query validation ────────────────────────────────────────

    describe('query validation', () => {
        it('generates query validation block', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('ctx.query');
            expect(output).toContain('page: z.coerce.number().int()');
            expect(output).toContain('limit: z.coerce.number().int()');
        });

        it('generates parseAndValidate import when operation has query', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate');
        });

        it('generates type-reference query validation', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { query: 'Pagination' })])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate(ctx.query, Pagination.strict())');
        });

        it('imports type-reference query type', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { query: 'Pagination' })])]);
            const output = generateOp(root);
            expect(output).toMatch(/import.*Pagination.*from/);
        });

        it('wraps inline array query params with z.preprocess for single-value coercion', () => {
            const root = opRoot([
                opRoute('/offers', [
                    opOperation('get', {
                        query: [opParam('status', arrayType(refType('OfferStatus'))), opParam('limit', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('z.preprocess');
            expect(output).toContain("typeof v === 'string' ? v.split(',') : v");
            // Non-array params should not be wrapped
            expect(output).toContain('limit: z.coerce.number().int()');
        });

        it('imports Input variant for refs inside an intersection query', () => {
            const root = opRoot([
                opRoute('/audit/log', [
                    opOperation('get', {
                        query: {
                            kind: 'intersection',
                            members: [
                                { kind: 'ref', name: 'Pagination' },
                                {
                                    kind: 'inlineObject',
                                    fields: [field('schemaName', scalarType('string'), { optional: true })],
                                },
                            ],
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any,
                    }),
                ]),
            ]);
            const output = generateOp(root, { modelsWithInput: new Set(['Pagination']) });
            expect(output).toContain('PaginationInput.extend({');
            expect(output).toContain('PaginationInput');
            // The import line must include PaginationInput, not just Pagination
            expect(output).toMatch(/import \{[^}]*\bPaginationInput\b[^}]*\} from /);
        });

        it('ref & ref intersection query uses .extend(B.shape) not .and()', () => {
            const root = opRoot([
                opRoute('/persons', [
                    opOperation('get', {
                        query: {
                            kind: 'intersection',
                            members: [
                                { kind: 'ref', name: 'Pagination' },
                                { kind: 'ref', name: 'PersonQuery' },
                            ],
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any,
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('Pagination.extend(PersonQuery.shape)');
            expect(output).not.toContain('.and(');
        });

        it('ref & ref intersection query substitutes Input variants', () => {
            const root = opRoot([
                opRoute('/persons', [
                    opOperation('get', {
                        query: {
                            kind: 'intersection',
                            members: [
                                { kind: 'ref', name: 'Pagination' },
                                { kind: 'ref', name: 'PersonQuery' },
                            ],
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        } as any,
                    }),
                ]),
            ]);
            const output = generateOp(root, { modelsWithInput: new Set(['Pagination']) });
            expect(output).toContain('PaginationInput.extend(PersonQuery.shape)');
        });

        it('wraps ContractTypeNode intersection query with array fields using z.preprocess', () => {
            const root = opRoot([
                opRoute('/offers', [
                    opOperation('get', {
                        query: {
                            kind: 'intersection',
                            members: [
                                { kind: 'ref', name: 'Pagination' },
                                {
                                    kind: 'inlineObject',
                                    fields: [field('status', arrayType(refType('OfferStatus')), { optional: true })],
                                },
                            ],
                        } as any,
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('Pagination.extend({');
            expect(output).toContain('z.preprocess');
            expect(output).toContain('.optional()');
        });
        it('coerces inline boolean query params with z.preprocess', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('active', scalarType('boolean')), opParam('page', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            // Boolean should use preprocess for string coercion
            expect(output).toContain("active: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean())");
            // Int should still use z.coerce
            expect(output).toContain('page: z.coerce.number().int()');
        });
    });

    // ─── Headers validation ─────────────────────────────────────

    describe('headers validation', () => {
        it('generates headers validation block', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        headers: [opParam('authorization', scalarType('string'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('ctx.headers');
            expect(output).toContain('authorization: z.string()');
            expect(output).toContain('z.object({');
        });

        it('generates parseAndValidate import when operation has headers', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        headers: [opParam('authorization', scalarType('string'))],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate');
        });

        it('generates type-reference headers validation', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { headers: 'CommonHeaders' })])]);
            const output = generateOp(root);
            expect(output).toContain('parseAndValidate(ctx.headers, CommonHeaders.strip())');
        });

        it('uses strict mode for headers when specified', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        headers: [opParam('authorization', scalarType('string'))],
                        headersMode: 'strict',
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('z.strictObject({');
        });

        it('uses strip mode for headers when specified', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        headers: [opParam('authorization', scalarType('string'))],
                        headersMode: 'strip',
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('z.object({');
        });
    });

    // ─── Request handling ─────────────────────────────────────────

    describe('request handling', () => {
        it('handles multipart/form-data request', () => {
            const root = opRoot([opRoute('/uploads', [opOperation('post', { request: opRequest('Upload', 'multipart/form-data') })])]);
            const output = generateOp(root);
            expect(output).toContain("bodyParserMiddleware(['multipart'])");
            expect(output).toContain('ctx.parsedBody as MultipartBody');
            expect(output).toContain("import { MultipartBody } from '@maroonedsoftware/multipart';");
        });
    });

    // ─── Response ─────────────────────────────────────────────────

    describe('response', () => {
        it('sets status code from response', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('CreateUser'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('ctx.status = 201');
        });

        it('sets application/json content type when response has body', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain("ctx.type = 'application/json'");
        });

        it('emits handlers for internal operations by default', () => {
            const root = opRoot([opRoute('/secret', [opOperation('get', { responses: [opResponse(200, 'User')] })], undefined, ['internal'])]);
            expect(generateOp(root)).toContain("'/secret'");
        });

        it('skips internal operations when includeInternal is false', () => {
            const root = opRoot([
                opRoute('/public', [opOperation('get', { responses: [opResponse(200, 'User')] })]),
                opRoute('/secret', [opOperation('get', { responses: [opResponse(200, 'User')] })], undefined, ['internal']),
            ]);
            const out = generateOp(root, { includeInternal: false });
            expect(out).toContain("'/public'");
            expect(out).not.toContain("'/secret'");
        });

        it("uses bodyParser 'text' token for text/* request mimes", () => {
            const root = opRoot([
                opRoute('/notes', [
                    opOperation('post', {
                        request: opRequest('Note', 'text/plain'),
                        responses: [opResponse(204)],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain("bodyParserMiddleware(['text'])");
        });

        it('emits the literal vendor JSON mime on ctx.type when declared', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/vnd.api+json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain("ctx.type = 'application/vnd.api+json'");
        });

        it('formats array response type annotation', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            expect(output).toContain('User[]');
        });

        it('annotates service result with { body, headers } when response declares headers', () => {
            const root = opRoot([
                opRoute(
                    '/transfers/{id}',
                    [
                        opOperation('get', {
                            responses: [
                                {
                                    statusCode: 200,
                                    hasBlock: true,
                                    bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Transfer' } }],
                                    headers: [
                                        { name: 'preference-applied', optional: true, type: { kind: 'scalar', name: 'string' } },
                                        { name: 'etag', optional: false, type: { kind: 'scalar', name: 'string' } },
                                    ],
                                },
                            ],
                        }),
                    ],
                    [opParam('id', { kind: 'scalar', name: 'uuid' })],
                ),
            ]);
            const output = generateOp(root);
            expect(output).toContain('{ body: Transfer; headers: { preferenceApplied?: string; etag: string } }');
            expect(output).toContain('ctx.set(\'etag\', String(result.headers["etag"]))');
            expect(output).toContain(
                'if (result.headers["preferenceApplied"] !== undefined) ctx.set(\'preference-applied\', String(result.headers["preferenceApplied"]))',
            );
            expect(output).toContain('ctx.body = result.body;');
        });

        it('annotates service result with { headers } for void ops with declared headers', () => {
            const root = opRoot([
                opRoute(
                    '/resources/{id}',
                    [
                        opOperation('delete', {
                            responses: [
                                {
                                    statusCode: 204,
                                    hasBlock: true,
                                    bodies: [],
                                    headers: [{ name: 'x-deleted-at', optional: false, type: { kind: 'scalar', name: 'string' } }],
                                },
                            ],
                        }),
                    ],
                    [opParam('id', { kind: 'scalar', name: 'uuid' })],
                ),
            ]);
            const output = generateOp(root);
            expect(output).toContain('{ headers: { xDeletedAt: string } }');
            expect(output).toContain('ctx.set(\'x-deleted-at\', String(result.headers["xDeletedAt"]))');
            expect(output).not.toContain('ctx.body =');
        });

        it('defaults to status 200 when no response specified', () => {
            const root = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).toContain('ctx.status = 200');
        });

        // ─── Which statuses the service produces ─────────────────────────

        describe('emitted-set dispatch', () => {
            const artBodies = [
                { contentType: 'image/png', bodyType: scalarType('binary') },
                { contentType: 'image/jpeg', bodyType: scalarType('binary') },
            ];

            it('leaves the common success-plus-bodyless-errors operation alone', () => {
                const root = opRoot([
                    opRoute('/pet', [
                        opOperation('get', {
                            responses: [opResponse(200, 'Pet', 'application/json'), opResponse(400), opResponse(404)],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain('const result: Pet = await service.list();');
                expect(output).toContain('ctx.status = 200;');
                expect(output).toContain("ctx.type = 'application/json';");
                expect(output).toContain('ctx.body = result;');
                expect(output).not.toContain('switch (result.status)');
            });

            it('lets the service pick the mime when a status declares several', () => {
                const root = opRoot([
                    opRoute('/art', [
                        opOperation('get', {
                            responses: [
                                opResponseMulti(200, artBodies, {
                                    headers: [{ name: 'etag', optional: true, type: scalarType('string') }],
                                }),
                                opResponse(304),
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain(
                    "const result: { contentType: 'image/png' | 'image/jpeg'; body: Buffer; headers: { etag?: string } } = await service.list();",
                );
                expect(output).toContain('ctx.status = 200;');
                expect(output).toContain('ctx.type = result.contentType;');
                expect(output).toContain('ctx.body = result.body;');
                // The bare 304 is documentation — middleware produces it, not the service.
                expect(output).not.toContain('switch (result.status)');
                expect(output).not.toContain('304');
            });

            it('keeps contentType correlated with body when the mimes carry different types', () => {
                const root = opRoot([
                    opRoute('/pet', [
                        opOperation('get', {
                            responses: [
                                opResponseMulti(200, [
                                    { contentType: 'application/json', bodyType: refType('Pet') },
                                    { contentType: 'text/csv', bodyType: scalarType('string') },
                                ]),
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain(
                    "const result: { contentType: 'application/json'; body: Pet } | { contentType: 'text/csv'; body: string } = await service.list();",
                );
            });

            it('switches on status when the service produces more than one', () => {
                const root = opRoot([
                    opRoute('/art', [
                        opOperation('get', {
                            responses: [
                                opResponseMulti(200, artBodies, {
                                    headers: [{ name: 'etag', optional: true, type: scalarType('string') }],
                                }),
                                opResponse(202, 'JobRef', 'application/json'),
                                opResponse(304),
                                opResponse(404),
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain("| { status: 200; contentType: 'image/png' | 'image/jpeg'; body: Buffer; headers: { etag?: string } }");
                expect(output).toContain("| { status: 202; contentType: 'application/json'; body: JobRef }");
                expect(output).toContain('ctx.status = result.status;');
                expect(output).toContain('switch (result.status) {');
                expect(output).toContain('        case 200:');
                expect(output).toContain('        case 202:');
                // Neither the middleware-produced 304 nor the thrown 404 is a case.
                expect(output).not.toContain('case 304:');
                expect(output).not.toContain('case 404:');
            });

            it('returns a body-bearing error status rather than leaving it to be thrown', () => {
                const root = opRoot([
                    opRoute('/pet', [
                        opOperation('get', {
                            responses: [
                                opResponse(200, 'Pet', 'application/json'),
                                opResponse(422, 'Problem', 'application/json'),
                                opResponse(404),
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain("| { status: 200; contentType: 'application/json'; body: Pet }");
                expect(output).toContain("| { status: 422; contentType: 'application/json'; body: Problem }");
                expect(output).toContain('        case 422:');
            });

            it('puts a documented status back on the throw path', () => {
                const root = opRoot([
                    opRoute('/pet', [
                        opOperation('get', {
                            responses: [
                                opResponse(200, 'Pet', 'application/json'),
                                { ...opResponse(422, 'Problem', 'application/json'), emit: 'documented' },
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain('const result: Pet = await service.list();');
                expect(output).not.toContain('switch (result.status)');
                expect(output).not.toContain('422');
            });

            it('emits a bodyless status the service opts into with an empty block', () => {
                const root = opRoot([
                    opRoute('/art', [
                        opOperation('get', {
                            responses: [opResponse(200, 'Art', 'application/json'), { statusCode: 304, bodies: [], hasBlock: true }],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain("| { status: 200; contentType: 'application/json'; body: Art }");
                expect(output).toContain('| { status: 304 }');
                expect(output).toContain('        case 304:');
                // Nothing to write for a bodyless member beyond the status itself.
                expect(output).toMatch(/case 304:\n\s+break;/);
            });

            it('gives each status its own schema variable so two complex bodies cannot collide', () => {
                const root = opRoot([
                    opRoute('/pet', [
                        opOperation('get', {
                            responses: [
                                opResponse(200, inlineObjectType([field('id', scalarType('int'))]), 'application/json'),
                                opResponse(422, inlineObjectType([field('detail', scalarType('string'))]), 'application/json'),
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toContain('const result200Type = ');
                expect(output).toContain('const result422Type = ');
            });

            it('writes only the headers belonging to the status that was returned', () => {
                const root = opRoot([
                    opRoute('/art', [
                        opOperation('get', {
                            responses: [
                                opResponse(200, 'Art', 'application/json'),
                                {
                                    ...opResponse(202, 'JobRef', 'application/json'),
                                    headers: [{ name: 'retry-after', optional: false, type: scalarType('string') }],
                                },
                            ],
                        }),
                    ]),
                ]);
                const output = generateOp(root);
                expect(output).toMatch(/case 202:\n\s+ctx\.set\('retry-after'/);
                expect(output).not.toMatch(/case 200:\n\s+ctx\.set/);
            });
        });

        it('uses Output variant for result type when response model has format(output=...)', () => {
            const root = opRoot([
                opRoute('/auth/token', [
                    opOperation('post', {
                        responses: [opResponse(200, 'AuthToken', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root, { modelsWithOutput: new Set(['AuthToken']) });
            expect(output).toContain('result: AuthTokenOutput');
            expect(output).toContain('AuthTokenOutput');
        });

        it('uses Output variant for array response when item model has format(output=...)', () => {
            const root = opRoot([
                opRoute('/auth/tokens', [
                    opOperation('get', {
                        responses: [opResponse(200, 'array(AuthToken)', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root, { modelsWithOutput: new Set(['AuthToken']) });
            expect(output).toContain('result: AuthTokenOutput[]');
        });

        // Scalar response bodies used to emit the .ck scalar name verbatim (`result: binary`),
        // which only happened to compile for `string`.
        describe('scalar response bodies map to the server-side TypeScript type', () => {
            const cases: Array<[string, string]> = [
                ['binary', 'Buffer'],
                ['int', 'number'],
                ['number', 'number'],
                ['bigint', 'bigint'],
                ['boolean', 'boolean'],
                ['string', 'string'],
                ['uuid', 'string'],
                ['email', 'string'],
                ['url', 'string'],
                ['datetime', 'DateTime'],
                ['date', 'DateTime'],
                ['time', 'DateTime'],
                ['duration', 'Duration'],
                ['interval', 'string'],
                ['json', '_JsonValue'],
                ['object', 'Record<string, unknown>'],
                ['unknown', 'unknown'],
                ['null', 'null'],
            ];

            for (const [scalar, tsType] of cases) {
                it(`renders ${scalar} as ${tsType}`, () => {
                    const root = opRoot([
                        opRoute('/x', [
                            opOperation('get', {
                                responses: [opResponse(200, scalarType(scalar as never), 'application/octet-stream')],
                            }),
                        ]),
                    ]);
                    expect(generateOp(root)).toContain(`const result: ${tsType} = await service.list();`);
                });
            }

            it('renders an array of binary as Buffer[]', () => {
                const root = opRoot([
                    opRoute('/x', [opOperation('get', { responses: [opResponse(200, arrayType(scalarType('binary')), 'application/json')] })]),
                ]);
                expect(generateOp(root)).toContain('const result: Buffer[] = await service.list();');
            });
        });

        describe('luxon imports cover every scalar that references a luxon class', () => {
            it('imports Duration for a duration response body', () => {
                const root = opRoot([opRoute('/x', [opOperation('get', { responses: [opResponse(200, scalarType('duration'), 'application/json')] })])]);
                expect(generateOp(root)).toContain("import { Duration } from 'luxon';");
            });

            it('imports Interval and emits the _ZodInterval helper for an interval body', () => {
                const root = opRoot([opRoute('/x', [opOperation('get', { responses: [opResponse(200, scalarType('interval'), 'application/json')] })])]);
                const output = generateOp(root);
                expect(output).toContain("import { Interval } from 'luxon';");
                expect(output).toContain('const _ZodInterval =');
            });

            it('imports DateTime and Duration together when both are used', () => {
                const root = opRoot([
                    opRoute('/x', [
                        opOperation('post', {
                            request: opRequest(scalarType('datetime')),
                            responses: [opResponse(200, scalarType('duration'), 'application/json')],
                        }),
                    ]),
                ]);
                expect(generateOp(root)).toContain("import { DateTime, Duration } from 'luxon';");
            });
        });
    });

    // ─── Service inference ────────────────────────────────────────

    describe('service inference', () => {
        it('uses explicit service when declared', () => {
            const root = opRoot([opRoute('/users', [opOperation('post', { service: 'LedgerService.updateNesting' })])]);
            const output = generateOp(root);
            expect(output).toContain('service.updateNesting(');
            expect(output).toContain('LedgerService');
        });

        it('infers service from file name when not declared', () => {
            const root = opRoot([opRoute('/categories', [opOperation('get')])], 'ledger.categories.op');
            const output = generateOp(root);
            expect(output).toContain('LedgerCategoriesService');
        });

        it('uses meta for service import path when declared', () => {
            const root = opRoot([opRoute('/capital', [opOperation('post', { service: 'LedgerService.disburse' })])], 'capital.op', {
                LedgerService: '#modules/ledger/ledger.service.js',
            });
            const output = generateOp(root);
            expect(output).toContain("import { LedgerService } from '#modules/ledger/ledger.service.js';");
        });

        it('falls back to deriveModulePath when meta has no entry for service', () => {
            const root = opRoot([opRoute('/capital', [opOperation('get')])], 'capital.op', { SomeOtherService: '#other/path.js' });
            const output = generateOp(root);
            expect(output).toContain("import { CapitalService } from '#modules/capital/capital.service.js';");
        });
    });

    // ─── Type collection ──────────────────────────────────────────

    describe('type collection', () => {
        it('collects PascalCase type names from body types', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            // Both types should be imported
            expect(output).toContain('CreateUserInput');
            expect(output).toContain('User');
        });

        it('unwraps array() in body types for collection', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOp(root);
            // User should be in the type import
            expect(output).toMatch(/import.*User.*from/);
        });
    });

    // ─── Source line comments ──────────────────────────────────────

    describe('source line comments', () => {
        it('includes source location in JSDoc above handler', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { loc: { file: 'users.op', line: 3 } })])], 'users.op');
            const output = generateOp(root);
            expect(output).toContain('file://./users.op#L3');
        });
    });

    // ─── JSDoc from descriptions ────────────────────────────────────

    describe('JSDoc from descriptions', () => {
        it('generates JSDoc comment from operation description', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { description: 'List all users' })])]);
            const output = generateOp(root);
            expect(output).toContain('* List all users');
        });

        it('falls back to route description when operation has none', () => {
            const root = opRoot([opRoute('/users', [opOperation('get')])]);
            root.routes[0]!.description = 'User routes';
            const output = generateOp(root);
            expect(output).toContain('* User routes');
        });

        it('includes source link JSDoc for all handlers', () => {
            const root = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateOp(root);
            expect(output).toContain('/**');
            expect(output).toContain('file://');
        });
    });

    // ─── Configurable paths ──────────────────────────────────────

    describe('configurable paths', () => {
        it('uses custom service path template', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])]);
            const output = generateOp(root, {
                servicePathTemplate: '@services/{kebab}.service.js',
            });
            expect(output).toContain("from '@services/user.service.js'");
        });

        it('uses custom type import path template', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const output = generateOp(root, {
                typeImportPathTemplate: '@types/{module}/index.js',
            });
            expect(output).toContain("from '@types/users/index.js'");
        });

        it('falls back to default paths when no template provided', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])]);
            const output = generateOp(root);
            expect(output).toContain("from '#modules/user/user.service.js'");
        });
    });
});

describe('generateOp — route modifiers JSDoc', () => {
    it('adds @internal to JSDoc for internal operation', () => {
        const root = opRoot([opRoute('/admin/users', [opOperation('get', { modifiers: ['internal'] })])]);
        const out = generateOp(root);
        expect(out).toContain('* @internal');
    });

    it('adds @deprecated to JSDoc for deprecated operation', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', { modifiers: ['deprecated'] })])]);
        const out = generateOp(root);
        expect(out).toContain('* @deprecated');
    });

    it('inherits route-level internal modifier for JSDoc', () => {
        const root = opRoot([opRoute('/admin', [opOperation('get')], undefined, ['internal'])]);
        const out = generateOp(root);
        expect(out).toContain('* @internal');
    });

    it('operation modifier overrides route modifier in JSDoc', () => {
        const root = opRoot([opRoute('/admin', [opOperation('get', { modifiers: ['deprecated'] })], undefined, ['internal'])]);
        const out = generateOp(root);
        expect(out).toContain('* @deprecated');
        expect(out).not.toContain('* @internal');
    });

    it('still generates router handler for internal operations', () => {
        const root = opRoot([opRoute('/admin/users', [opOperation('get', { modifiers: ['internal'] })])]);
        const out = generateOp(root);
        // Handler is always generated (internal only affects SDK/docs)
        expect(out).toContain("UsersRouter.get('/admin/users'");
    });

    // ─── Security JSDoc ────────────────────────────────────────────

    describe('security JSDoc', () => {
        it('emits anonymous access, no security required for security: none', () => {
            const op = opOperation('get', { security: SECURITY_NONE });
            const root = opRoot([opRoute('/health', [op])]);
            const out = generateOp(root);
            expect(out).toContain('anonymous access, no security required');
        });

        it('emits no annotation for security with policy', () => {
            const op = opOperation('get', {
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
            });
            const root = opRoot([opRoute('/users', [op])]);
            const out = generateOp(root);
            expect(out).not.toContain('@authenticated');
        });

        it('emits no annotation for operation with signature', () => {
            const op = opOperation('post', {
                signature: 'hmac-sha256',
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const out = generateOp(root);
            expect(out).not.toContain('@authenticated');
        });

        it('emits no annotation when security is not set', () => {
            const op = opOperation('get');
            const root = opRoot([opRoute('/users', [op])]);
            const out = generateOp(root);
            expect(out).not.toContain('anonymous access, no security required');
            expect(out).not.toContain('@authenticated');
        });
    });

    // ─── Signature middleware ───────────────────────────────────────

    describe('signature middleware', () => {
        it('injects requireSignature middleware and imports it when signature is set', () => {
            const op = opOperation('post', {
                signature: 'MODERN_TREASURY_WEBHOOK',
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requirePolicy, requireSignature }`);
            expect(out).toContain(`requireSignature('MODERN_TREASURY_WEBHOOK')`);
        });

        it('passes the signature policy to requireSignature when set', () => {
            const op = opOperation('post', {
                signature: 'SLACK_WEBHOOK',
                signaturePolicy: 'slackSignatureValid',
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`requireSignature('SLACK_WEBHOOK', { policy: 'slackSignatureValid' })`);
        });

        it('places requireSignature after bodyParserMiddleware in the route line', () => {
            const op = opOperation('post', {
                signature: 'MY_KEY',
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const routeLine = generateOp(root)
                .split('\n')
                .find(l => l.includes('.post('));
            expect(routeLine).toBeDefined();
            const sigIdx = routeLine!.indexOf(`requireSignature('MY_KEY')`);
            const bodyIdx = routeLine!.indexOf(`bodyParserMiddleware`);
            expect(sigIdx).toBeGreaterThan(-1);
            expect(sigIdx).toBeGreaterThan(bodyIdx);
        });

        it('does not import requireSignature when no signature is set', () => {
            const op = opOperation('get', {
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
            });
            const root = opRoot([opRoute('/users', [op])]);
            const out = generateOp(root);
            expect(out).not.toContain('requireSignature');
            expect(out).toContain(`import { ServerKitRouter, requirePolicy }`);
        });
    });

    // ─── Policy middleware ──────────────────────────────────────────

    describe('policy middleware', () => {
        it('injects requirePolicy() with no args for unannotated routes', () => {
            const op = opOperation('get');
            const root = opRoot([opRoute('/users', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`import { ServerKitRouter, requirePolicy }`);
            expect(out).toContain(`requirePolicy()`);
        });

        it('injects requirePolicy with a named policy when set', () => {
            const op = opOperation('get', {
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
            });
            const root = opRoot([opRoute('/users', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`requirePolicy({ policy: 'paymentsWrite' })`);
        });

        it('injects requirePolicy with policy: false when explicitly bypassed', () => {
            const op = opOperation('get', {
                security: { policy: false, loc: { file: 'test.op', line: 1 } },
            });
            const routeLine = generateOp(opRoot([opRoute('/users', [op])]))
                .split('\n')
                .find(l => l.includes('.get('));
            expect(routeLine).toContain(`requirePolicy({ policy: false })`);
        });

        it('does not inject requirePolicy for public (security: none) routes', () => {
            const op = opOperation('get', { security: SECURITY_NONE });
            const root = opRoot([opRoute('/health', [op])]);
            const out = generateOp(root);
            expect(out).not.toContain('requirePolicy');
        });

        it('does not import requirePolicy when all routes are public', () => {
            const op = opOperation('get', { security: SECURITY_NONE });
            const root = opRoot([opRoute('/health', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`import { ServerKitRouter } from`);
            expect(out).not.toContain('requirePolicy');
        });

        it('places requirePolicy before bodyParserMiddleware in the route line', () => {
            const op = opOperation('post', {
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/users', [op])]);
            const routeLine = generateOp(root)
                .split('\n')
                .find(l => l.includes('.post('));
            expect(routeLine).toBeDefined();
            const polIdx = routeLine!.indexOf(`requirePolicy`);
            const bodyIdx = routeLine!.indexOf(`bodyParserMiddleware`);
            expect(polIdx).toBeGreaterThan(-1);
            expect(bodyIdx).toBeGreaterThan(polIdx);
        });

        it('places requirePolicy before requireSignature when both are set', () => {
            const op = opOperation('post', {
                signature: 'MY_KEY',
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const routeLine = generateOp(root)
                .split('\n')
                .find(l => l.includes('.post('));
            expect(routeLine).toBeDefined();
            const polIdx = routeLine!.indexOf(`requirePolicy`);
            const sigIdx = routeLine!.indexOf(`requireSignature`);
            expect(polIdx).toBeGreaterThan(-1);
            expect(sigIdx).toBeGreaterThan(polIdx);
        });

        it('imports both requirePolicy and requireSignature when both are set', () => {
            const op = opOperation('post', {
                signature: 'MY_KEY',
                security: { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } },
                request: opRequest('Payload'),
            });
            const root = opRoot([opRoute('/webhooks', [op])]);
            const out = generateOp(root);
            expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requirePolicy, requireSignature }`);
        });

        it('works with route-level policy security', () => {
            const op = opOperation('get');
            const route = opRoute('/users', [op]);
            route.security = { policy: 'paymentsWrite', loc: { file: 'test.op', line: 1 } };
            const root = opRoot([route]);
            const out = generateOp(root);
            expect(out).toContain(`requirePolicy({ policy: 'paymentsWrite' })`);
        });
    });
});
