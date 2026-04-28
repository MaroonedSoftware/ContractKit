import { describe, it, expect } from 'vitest';
import { parseCk, DiagnosticCollector } from '@maroonedsoftware/contractkit';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertOpenApiToCk } from '../src/convert.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

describe('convertOpenApiToCk', () => {
    describe('OpenAPI 3.1 Petstore', () => {
        it('converts to split .ck files by tag', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

            expect(result.files.size).toBeGreaterThan(0);

            // Should have pets and store files
            const filenames = [...result.files.keys()];
            expect(filenames.some(f => f.includes('pets'))).toBe(true);
            expect(filenames.some(f => f.includes('store'))).toBe(true);
        });

        it('includes Pet model in pets file', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

            const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
            expect(petsFile).toBeDefined();
            const [, content] = petsFile!;

            expect(content).toContain('contract Pet:');
            expect(content).toContain('id: readonly uuid');
            expect(content).toContain('name: string(min=1, max=100)');
            expect(content).toContain('status: enum(available, pending, sold)');
            expect(content).toContain('createdAt: readonly datetime');
        });

        it('includes operations in pets file', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

            const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
            const [, content] = petsFile!;

            expect(content).toContain('operation /pets:');
            expect(content).toContain('get:');
            expect(content).toContain('post:');
            expect(content).toContain('operation /pets/{petId}:');
            expect(content).toContain('sdk: listPets');
            expect(content).toContain('sdk: createPet');
        });

        it('marks delete with security: none', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'by-tag' });

            const petsFile = [...result.files.entries()].find(([k]) => k.includes('pets'));
            const [, content] = petsFile!;

            expect(content).toContain('security: none');
        });

        it('converts to single file', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single' });

            expect(result.files.size).toBe(1);
            expect(result.files.has('api.ck')).toBe(true);

            const content = result.files.get('api.ck')!;
            expect(content).toContain('contract Pet:');
            expect(content).toContain('operation /pets:');
            expect(content).toContain('operation /store/inventory:');
        });

        it('includes descriptions as comments', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single', includeComments: true });

            const content = result.files.get('api.ck')!;
            expect(content).toContain('# A pet in the store');
            expect(content).toContain('# The pet identifier');
        });

        it('omits comments when includeComments is false', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single', includeComments: false });

            const content = result.files.get('api.ck')!;
            expect(content).not.toContain('#');
        });

        it('handles path params', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single' });

            const content = result.files.get('api.ck')!;
            expect(content).toContain('params: {');
            expect(content).toContain('petId: uuid');
        });

        it('handles record types (additionalProperties)', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single' });

            const content = result.files.get('api.ck')!;
            // Store inventory returns a record
            expect(content).toContain('record(string, int)');
        });

        it('handles empty responses (204)', async () => {
            const spec = JSON.parse(readFileSync(resolve(fixturesDir, 'petstore-3.1.json'), 'utf-8'));
            const result = await convertOpenApiToCk({ input: spec, split: 'single' });

            const content = result.files.get('api.ck')!;
            expect(content).toContain('204:');
        });
    });

    describe('inline spec object', () => {
        it('converts a minimal spec', async () => {
            const result = await convertOpenApiToCk({
                input: {
                    openapi: '3.1.0',
                    info: { title: 'Minimal', version: '1.0' },
                    components: {
                        schemas: {
                            Ping: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] },
                        },
                    },
                    paths: {
                        '/ping': {
                            get: {
                                operationId: 'ping',
                                responses: {
                                    '200': {
                                        description: 'OK',
                                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Ping' } } },
                                    },
                                },
                            },
                        },
                    },
                },
                split: 'single',
            });

            expect(result.files.size).toBe(1);
            const content = result.files.get('api.ck')!;
            expect(content).toContain('contract Ping:');
            expect(content).toContain('ok: boolean');
            expect(content).toContain('operation /ping:');
        });
    });

    describe('response headers', () => {
        it('lifts OpenAPI 3.x response headers into a typed headers block', async () => {
            const result = await convertOpenApiToCk({
                input: {
                    openapi: '3.1.0',
                    info: { title: 'T', version: '1.0' },
                    components: {
                        schemas: {
                            Transfer: { type: 'object', properties: { id: { type: 'string', format: 'uuid' } }, required: ['id'] },
                        },
                    },
                    paths: {
                        '/transfers/{id}': {
                            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
                            get: {
                                operationId: 'getTransfer',
                                responses: {
                                    '200': {
                                        description: 'OK',
                                        content: { 'application/json': { schema: { $ref: '#/components/schemas/Transfer' } } },
                                        headers: {
                                            'preference-applied': { schema: { type: 'string' } },
                                            ETag: { description: 'cache validator', required: true, schema: { type: 'string' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                split: 'single',
            });
            const ck = result.files.get('api.ck')!;
            expect(ck).toContain('200: {');
            expect(ck).toContain('application/json: Transfer');
            expect(ck).toContain('headers: {');
            expect(ck).toContain('preference-applied?: string');
            expect(ck).toContain('ETag: string # cache validator');

            // Round-trip: the generated .ck must parse cleanly back into an AST with the same headers.
            const diag = new DiagnosticCollector();
            const root = parseCk(ck, 'api.ck', diag);
            expect(diag.hasErrors()).toBe(false);
            const op = root.routes[0]!.operations[0]!;
            const respHeaders = op.responses[0]!.headers!;
            expect(respHeaders.map(h => h.name)).toEqual(['preference-applied', 'ETag']);
            expect(respHeaders[0]!.optional).toBe(true);
            expect(respHeaders[1]!.optional).toBe(false);
        });

        it('lifts response headers when the status has no body', async () => {
            const result = await convertOpenApiToCk({
                input: {
                    openapi: '3.1.0',
                    info: { title: 'T', version: '1.0' },
                    paths: {
                        '/resources/{id}': {
                            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                            delete: {
                                operationId: 'deleteResource',
                                responses: {
                                    '204': {
                                        description: 'No Content',
                                        headers: {
                                            'x-deleted-at': { required: true, schema: { type: 'string' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                split: 'single',
            });
            const ck = result.files.get('api.ck')!;
            expect(ck).toContain('204: {');
            expect(ck).toContain('headers: {');
            expect(ck).toContain('x-deleted-at: string');
        });

        it('lifts Swagger 2.0 response headers via normalize', async () => {
            const result = await convertOpenApiToCk({
                input: {
                    swagger: '2.0',
                    info: { title: 'T', version: '1.0' },
                    paths: {
                        '/things': {
                            get: {
                                operationId: 'listThings',
                                produces: ['application/json'],
                                responses: {
                                    '200': {
                                        description: 'OK',
                                        schema: { type: 'array', items: { type: 'string' } },
                                        headers: {
                                            'X-Rate-Limit': { type: 'integer', description: 'requests left' },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                split: 'single',
            });
            const ck = result.files.get('api.ck')!;
            expect(ck).toContain('headers: {');
            expect(ck).toContain('X-Rate-Limit?: int');
            expect(ck).toContain('requests left');
        });
    });

    describe('warnings', () => {
        it('collects warnings for unsupported features', async () => {
            const warnings: string[] = [];
            await convertOpenApiToCk({
                input: {
                    openapi: '3.1.0',
                    info: { title: 'Test', version: '1.0' },
                    components: {
                        schemas: {
                            WithXml: {
                                type: 'object',
                                xml: { name: 'thing' },
                                properties: { id: { type: 'string' } },
                            },
                        },
                    },
                    paths: {},
                },
                split: 'single',
                onWarning: w => warnings.push(w.message),
            });

            expect(warnings.some(w => w.includes('xml'))).toBe(true);
        });

        it('lowers oneOf with discriminator to a discriminatedUnion', async () => {
            const warnings: string[] = [];
            const result = await convertOpenApiToCk({
                input: {
                    openapi: '3.1.0',
                    info: { title: 'Test', version: '1.0' },
                    components: {
                        schemas: {
                            Card: {
                                type: 'object',
                                properties: { kind: { type: 'string', enum: ['card'] }, last4: { type: 'string' } },
                                required: ['kind', 'last4'],
                            },
                            Bank: {
                                type: 'object',
                                properties: { kind: { type: 'string', enum: ['bank'] }, accountId: { type: 'string' } },
                                required: ['kind', 'accountId'],
                            },
                            PaymentMethod: {
                                oneOf: [{ $ref: '#/components/schemas/Card' }, { $ref: '#/components/schemas/Bank' }],
                                discriminator: { propertyName: 'kind' },
                            },
                        },
                    },
                    paths: {},
                },
                split: 'single',
                onWarning: w => warnings.push(w.message),
            });

            const content = result.files.get('api.ck')!;
            expect(content).toContain('discriminated(by=kind');
            expect(warnings.some(w => w.includes('discriminator'))).toBe(false);
        });
    });
});
