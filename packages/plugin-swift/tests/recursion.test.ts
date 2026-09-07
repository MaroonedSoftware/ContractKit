import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import { collectHoistedTypes } from '../src/hoist.js';
import { collectBoxedFields } from '../src/recursion.js';
import {
    arrayType,
    contractRoot,
    field,
    inlineObjectType,
    lazyType,
    model,
    recordType,
    refType,
    scalarType,
    tupleType,
    unionType,
} from './helpers.js';
import type { ContractRootNode, ModelNode } from './helpers.js';

/**
 * A Swift struct cannot store itself, so the pass has to find the fields that close a cycle. Run
 * the real hoist first: which shapes are structs at all is its answer, not this pass's.
 */
function boxed(roots: ContractRootNode[]): string[] {
    const models: ModelNode[] = roots.flatMap(r => r.models);
    const modelIndex = buildModelIndex(models);
    const hoisted = collectHoistedTypes(roots, { modelIndex, modelsWithInput: new Set() });
    return [...collectBoxedFields(roots, { modelIndex, hoisted })];
}

describe('direct cycles', () => {
    it('boxes an optional self-reference behind lazy()', () => {
        expect(boxed([contractRoot([model('Node', [field('parent', lazyType(refType('Node')), { optional: true })])])])).toEqual(['Node.parent']);
    });

    it('boxes a self-reference with no lazy marker, which Swift rejects just the same', () => {
        expect(boxed([contractRoot([model('Node', [field('parent', refType('Node'), { optional: true })])])])).toEqual(['Node.parent']);
    });

    it('boxes a required self-reference too', () => {
        expect(boxed([contractRoot([model('Node', [field('parent', refType('Node'))])])])).toEqual(['Node.parent']);
    });
});

describe('shapes that already sit on the heap', () => {
    it('leaves an array alone', () => {
        expect(boxed([contractRoot([model('Node', [field('children', arrayType(refType('Node')))])])])).toEqual([]);
    });

    it('leaves a dictionary alone', () => {
        expect(boxed([contractRoot([model('Node', [field('byId', recordType(scalarType('string'), refType('Node')))])])])).toEqual([]);
    });

    it('leaves a cycle that passes through a union alone, since the enum is indirect', () => {
        const root = contractRoot([model('Node', [field('value', unionType(refType('Node'), scalarType('string')))])]);
        expect(boxed([root])).toEqual([]);
    });
});

describe('indirect cycles', () => {
    it('boxes both sides of an A to B to A cycle', () => {
        const root = contractRoot([
            model('A', [field('b', refType('B'), { optional: true })]),
            model('B', [field('a', refType('A'), { optional: true })]),
        ]);
        expect(boxed([root])).toEqual(['A.b', 'B.a']);
    });

    it('follows a cycle across files, which one Swift module joins anyway', () => {
        const a = contractRoot([model('A', [field('b', refType('B'), { optional: true })])], 'a.ck');
        const b = contractRoot([model('B', [field('a', refType('A'), { optional: true })])], 'b.ck');
        expect(boxed([a, b])).toEqual(['A.b', 'B.a']);
    });

    it('does not box a reference that only points one way', () => {
        const root = contractRoot([model('A', [field('b', refType('B'))]), model('B', [field('v', scalarType('string'))])]);
        expect(boxed([root])).toEqual([]);
    });
});

describe('hoisted declarations', () => {
    it('boxes a hoisted struct that reaches back to its owner', () => {
        // Both edges of the cycle are boxed. Breaking either one would do, but boxing every edge
        // in the component is what makes the answer independent of which model was walked first.
        const root = contractRoot([model('Node', [field('meta', inlineObjectType([field('owner', refType('Node'))]))])]);
        expect(boxed([root])).toEqual(['Node.meta', 'NodeMeta.owner']);
    });

    it('boxes a tuple item that closes a cycle, keyed by its position', () => {
        const root = contractRoot([model('Node', [field('pair', tupleType(refType('Node'), scalarType('string')))])]);
        expect(boxed([root])).toEqual(['Node.pair', 'NodePair._0']);
    });
});

describe('output', () => {
    it('is sorted, so the set can be fingerprinted without churn', () => {
        const root = contractRoot([
            model('Z', [field('a', refType('A'), { optional: true })]),
            model('A', [field('z', refType('Z'), { optional: true })]),
        ]);
        const result = boxed([root]);
        expect(result).toEqual([...result].sort());
    });
});
