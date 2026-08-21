import { describe, it, expect } from 'vitest';
import { convertAndParse, onlyOperation, responseFor } from './helpers.js';

/**
 * Only `#/components/schemas/*` refs survive into `.ck` as model references. Every other
 * component section has no `.ck` counterpart and nothing downstream resolved it, so a `$ref`'d
 * parameter used to reach the printer with no name and emit `undefined: string` — which parses,
 * making the corruption invisible.
 */
describe('component $ref inlining', () => {
    const base = {
        openapi: '3.1.0',
        info: { title: 'T', version: '1.0' },
        components: {
            schemas: { Pet: { type: 'object', properties: { id: { type: 'string' } } } },
            parameters: {
                Limit: { name: 'limit', in: 'query', description: 'page size', schema: { type: 'integer' } },
                TraceId: { name: 'x-trace-id', in: 'header', required: true, schema: { type: 'string' } },
            },
            headers: { RateLimit: { description: 'requests left', schema: { type: 'integer' } } },
            responses: {
                NotFound: { description: 'missing', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
            },
            requestBodies: {
                PetBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
            },
        },
    };

    it('inlines a $ref parameter instead of emitting a nameless one', async () => {
        const { root, warnings } = await convertAndParse({
            input: {
                ...base,
                paths: {
                    '/pets': {
                        get: {
                            operationId: 'listPets',
                            parameters: [{ $ref: '#/components/parameters/Limit' }, { $ref: '#/components/parameters/TraceId' }],
                            responses: { '200': { description: 'ok' } },
                        },
                    },
                },
            },
        });
        const op = onlyOperation(root);
        expect(op.query).toEqual(expect.objectContaining({ kind: 'params' }));
        const query = op.query as { kind: 'params'; nodes: { name: string; optional: boolean }[] };
        expect(query.nodes.map(n => n.name)).toEqual(['limit']);
        expect(query.nodes[0]!.optional).toBe(true);

        const headers = op.headers as { kind: 'params'; nodes: { name: string; optional: boolean }[] };
        expect(headers.nodes.map(n => n.name)).toEqual(['x-trace-id']);
        expect(headers.nodes[0]!.optional).toBe(false);

        expect(warnings.filter(w => w.message.includes('no name'))).toHaveLength(0);
    });

    it('inlines a $ref response and request body, keeping the schema ref a model ref', async () => {
        const { root, ck } = await convertAndParse({
            input: {
                ...base,
                paths: {
                    '/pets': {
                        post: {
                            operationId: 'createPet',
                            requestBody: { $ref: '#/components/requestBodies/PetBody' },
                            responses: { '201': { description: 'made' }, '404': { $ref: '#/components/responses/NotFound' } },
                        },
                    },
                },
            },
        });
        const op = onlyOperation(root);
        expect(op.request!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'Pet' });
        expect(responseFor(op, 404).bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'Pet' });
        expect(ck).not.toContain('$ref');
    });

    it('inlines a $ref response header', async () => {
        const { root } = await convertAndParse({
            input: {
                ...base,
                paths: {
                    '/pets': {
                        get: {
                            operationId: 'listPets',
                            responses: { '200': { description: 'ok', headers: { 'X-Rate-Limit': { $ref: '#/components/headers/RateLimit' } } } },
                        },
                    },
                },
            },
        });
        expect(responseFor(onlyOperation(root), 200).headers!.map(h => h.name)).toEqual(['X-Rate-Limit']);
    });

    it('warns and drops rather than emitting a nameless parameter for an unresolvable $ref', async () => {
        const { root, warnings } = await convertAndParse({
            input: {
                ...base,
                paths: {
                    '/pets': {
                        get: {
                            operationId: 'listPets',
                            parameters: [{ $ref: '#/components/parameters/Nope' }],
                            responses: { '200': { description: 'ok' } },
                        },
                    },
                },
            },
        });
        expect(warnings.some(w => w.message.includes("unresolved $ref '#/components/parameters/Nope'"))).toBe(true);
        expect(onlyOperation(root).query).toBeUndefined();
    });
});
