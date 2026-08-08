import { describe, it, expect } from 'vitest';
import { emittedResponses, observableResponses, thrownResponses, isRedundantDocumented } from '../src/response-sets.js';
import type { OpResponseNode } from '../src/ast.js';
import { opOperation } from './helpers.js';

/** `200:` — bare, no braces. */
function bare(statusCode: number, emit?: 'documented'): OpResponseNode {
    return emit ? { statusCode, bodies: [], emit } : { statusCode, bodies: [] };
}

/** `200: {}` — braced but carrying nothing. */
function emptyBlock(statusCode: number, emit?: 'documented'): OpResponseNode {
    return { statusCode, bodies: [], hasBlock: true, ...(emit ? { emit } : {}) };
}

/** `200: { application/json: Pet }`. */
function withBody(statusCode: number, emit?: 'documented'): OpResponseNode {
    return {
        statusCode,
        bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Pet' } }],
        hasBlock: true,
        ...(emit ? { emit } : {}),
    };
}

function op(...responses: OpResponseNode[]) {
    return opOperation('get', { responses });
}

const codes = (rs: OpResponseNode[]) => rs.map(r => r.statusCode);

describe('the emission derivation', () => {
    // A status is emitted if it has a block, or is 2xx. Both axes, every status class.
    const cases: { name: string; resp: OpResponseNode; emitted: boolean }[] = [
        { name: '200 with a body', resp: withBody(200), emitted: true },
        { name: '200 bare', resp: bare(200), emitted: true },
        { name: '204 bare', resp: bare(204), emitted: true },
        { name: '204 empty block', resp: emptyBlock(204), emitted: true },
        { name: '301 with a body', resp: withBody(301), emitted: true },
        { name: '304 bare', resp: bare(304), emitted: false },
        { name: '304 empty block', resp: emptyBlock(304), emitted: true },
        { name: '400 bare', resp: bare(400), emitted: false },
        { name: '400 empty block', resp: emptyBlock(400), emitted: true },
        { name: '422 with a body', resp: withBody(422), emitted: true },
        { name: '500 bare', resp: bare(500), emitted: false },
        { name: '503 with a body', resp: withBody(503), emitted: true },
    ];

    for (const { name, resp, emitted } of cases) {
        it(`${emitted ? 'emits' : 'does not emit'} ${name}`, () => {
            expect(emittedResponses(op(resp))).toHaveLength(emitted ? 1 : 0);
        });
    }

    it('forces any emitted status back out with (documented)', () => {
        for (const resp of [withBody(200, 'documented'), bare(204, 'documented'), emptyBlock(304, 'documented'), withBody(422, 'documented')]) {
            expect(emittedResponses(op(resp))).toHaveLength(0);
        }
    });
});

describe('emittedResponses', () => {
    it('leaves the common success-plus-errors operation with a single member', () => {
        expect(codes(emittedResponses(op(withBody(200), bare(400), bare(404))))).toEqual([200]);
    });

    it('sorts by status code, so a merged-in response cannot reorder generated output', () => {
        expect(codes(emittedResponses(op(withBody(422), withBody(200), withBody(202))))).toEqual([200, 202, 422]);
    });

    it('is empty when every declared status is documented or a bare error', () => {
        expect(emittedResponses(op(withBody(200, 'documented'), bare(304), bare(404)))).toHaveLength(0);
    });
});

describe('observableResponses', () => {
    it('includes a bare 304 the router never writes, because a client still receives it', () => {
        const operation = op(withBody(200), bare(304), bare(404));
        expect(codes(emittedResponses(operation))).toEqual([200]);
        expect(codes(observableResponses(operation))).toEqual([200, 304]);
    });

    it('includes an emitted error status', () => {
        expect(codes(observableResponses(op(withBody(200), withBody(422), bare(404))))).toEqual([200, 422]);
    });

    it('excludes an error status forced back onto the throw path', () => {
        expect(codes(observableResponses(op(withBody(200), withBody(422, 'documented'))))).toEqual([200]);
    });

    it('includes a documented 2xx, which the client can still receive', () => {
        expect(codes(observableResponses(op(withBody(200), withBody(202, 'documented'))))).toEqual([200, 202]);
    });
});

describe('thrownResponses', () => {
    it('is the complement of observableResponses over the declared set', () => {
        const operation = op(withBody(200), withBody(422), bare(404), bare(500));
        expect(codes(thrownResponses(operation))).toEqual([404, 500]);
        const seen = [...codes(observableResponses(operation)), ...codes(thrownResponses(operation))].sort((a, b) => a - b);
        expect(seen).toEqual([200, 404, 422, 500]);
    });

    it('carries a body-bearing error back onto the throw path when documented', () => {
        expect(codes(thrownResponses(op(withBody(200), withBody(422, 'documented'))))).toEqual([422]);
    });
});

describe('isRedundantDocumented', () => {
    it('flags (documented) on a status that was never emitted anyway', () => {
        expect(isRedundantDocumented(bare(404, 'documented'))).toBe(true);
        expect(isRedundantDocumented(bare(304, 'documented'))).toBe(true);
    });

    it('accepts (documented) where it actually changes the outcome', () => {
        expect(isRedundantDocumented(withBody(404, 'documented'))).toBe(false);
        expect(isRedundantDocumented(bare(204, 'documented'))).toBe(false);
        expect(isRedundantDocumented(emptyBlock(304, 'documented'))).toBe(false);
    });

    it('ignores responses with no modifier', () => {
        expect(isRedundantDocumented(bare(404))).toBe(false);
    });
});
