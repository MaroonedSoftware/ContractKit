import { describe, it, expect } from 'vitest';
import { emittedResponses, thrownResponses } from '@contractkit/core';
import { convertAndParse, onlyOperation, responseFor } from './helpers.js';

/**
 * OpenAPI cannot say whether a handler *returns* a status or merely documents it; `.ck` can, and
 * every generator downstream depends on the answer. A bodied `404` imported as service-produced
 * makes the generated router responsible for writing it and makes the SDKs hand it back as a
 * value instead of throwing — wrong for what is almost always an error contract.
 *
 * These assert on the parsed AST and on core's own response sets rather than on the emitted
 * text, so they check the meaning the generators will see.
 */

function specWith(responses: Record<string, unknown>) {
    return {
        openapi: '3.1.0',
        info: { title: 'T', version: '1.0' },
        paths: { '/pets': { get: { operationId: 'listPets', responses } } },
        components: {
            schemas: {
                Pet: { type: 'object', properties: { id: { type: 'string' } } },
                Error: { type: 'object', properties: { message: { type: 'string' } } },
            },
        },
    };
}

const json = (ref: string) => ({ description: 'd', content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } });

describe('imported error responses', () => {
    it('marks a bodied 4xx/5xx as documented, leaving 2xx emitted', async () => {
        const { root, ck } = await convertAndParse({
            input: specWith({ '200': json('Pet'), '404': json('Error'), '500': json('Error') }),
        });
        const op = onlyOperation(root);

        expect(responseFor(op, 200).emit).toBeUndefined();
        expect(responseFor(op, 404).emit).toBe('documented');
        expect(responseFor(op, 500).emit).toBe('documented');

        // The service produces only the 200; the error bodies reach a client as thrown errors.
        expect(emittedResponses(op).map(r => r.statusCode)).toEqual([200]);
        expect(thrownResponses(op).map(r => r.statusCode)).toEqual([404, 500]);

        // The modifier is lexical — `404 (documented)` with a space is a parse error.
        expect(ck).toContain('404(documented): {');
    });

    it('leaves a bare bodyless 4xx alone, so the modifier is never redundant', async () => {
        const { root, ck } = await convertAndParse({
            input: specWith({ '200': json('Pet'), '429': { description: 'slow down' } }),
        });
        const op = onlyOperation(root);

        // Already not emitted without the marker; `isRedundantDocumented` would warn on it.
        expect(responseFor(op, 429).emit).toBeUndefined();
        expect(responseFor(op, 429).hasBlock).toBeFalsy();
        expect(ck).not.toContain('429(documented)');
        expect(thrownResponses(op).map(r => r.statusCode)).toEqual([429]);
    });

    it('leaves 3xx emitted, since a client observes it either way', async () => {
        const { root } = await convertAndParse({
            input: specWith({ '200': json('Pet'), '304': { description: 'not modified' } }),
        });
        const op = onlyOperation(root);
        expect(responseFor(op, 304).emit).toBeUndefined();
    });

    it('documents a bodyless error status that carries only headers', async () => {
        const { root } = await convertAndParse({
            input: specWith({
                '200': json('Pet'),
                '503': { description: 'unavailable', headers: { 'Retry-After': { schema: { type: 'integer' } } } },
            }),
        });
        const op = onlyOperation(root);
        // Headers force a block, which without the marker would mean "the service produces this".
        expect(responseFor(op, 503).emit).toBe('documented');
        expect(thrownResponses(op).map(r => r.statusCode)).toEqual([503]);
    });

    it('reproduces the old behaviour under errorResponses: emitted', async () => {
        const { root, ck } = await convertAndParse({
            input: specWith({ '200': json('Pet'), '404': json('Error') }),
            errorResponses: 'emitted',
        });
        const op = onlyOperation(root);
        expect(responseFor(op, 404).emit).toBeUndefined();
        expect(emittedResponses(op).map(r => r.statusCode)).toEqual([200, 404]);
        expect(ck).not.toContain('(documented)');
    });
});
