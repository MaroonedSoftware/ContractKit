import { describe, expect, it } from 'vitest';
import { buildModelIndex, resolveEffectiveFields } from '../src/index.js';
import { field, inlineObjectType, model, refType, scalarType } from './helpers.js';

describe('resolveEffectiveFields', () => {
    it('returns own fields for a simple contract', () => {
        const idx = buildModelIndex([
            model('Todo', [
                field('id', scalarType('int')),
                field('name', scalarType('string')),
            ]),
        ]);
        const result = resolveEffectiveFields('Todo', idx);
        expect(result.fields.map(f => f.name)).toEqual(['id', 'name']);
        expect(result.unresolved).toEqual([]);
    });

    it('flattens multi-base inheritance with bases first then own fields', () => {
        const idx = buildModelIndex([
            model('A', [field('a', scalarType('boolean'))]),
            model('B', [field('b', scalarType('int'))]),
            model('C',
                [field('c', scalarType('string'))],
                { bases: ['A', 'B'] },
            ),
        ]);
        const result = resolveEffectiveFields('C', idx);
        expect(result.fields.map(f => f.name)).toEqual(['a', 'b', 'c']);
        expect(result.unresolved).toEqual([]);
    });

    it('follows type-alias bases through inline objects and intersections', () => {
        const idx = buildModelIndex([
            // Pagination is an alias to an intersection of two refs
            model('BasePagination', [
                field('page', scalarType('int')),
                field('pageSize', scalarType('int')),
            ]),
            model('SortOptions', [field('sort', scalarType('string'))]),
            model('Pagination', [], {
                type: { kind: 'intersection', members: [refType('BasePagination'), refType('SortOptions')] },
            }),
            // BusinessPagination extends the alias
            model('BusinessPagination',
                [field('extra', scalarType('int'))],
                { bases: ['Pagination'] },
            ),
        ]);
        const result = resolveEffectiveFields('BusinessPagination', idx);
        expect(result.fields.map(f => f.name)).toEqual(['page', 'pageSize', 'sort', 'extra']);
    });

    it('dedupes diamond inheritance with last-wins semantics', () => {
        // Diamond: D extends B & C, both B and C extend A. `a` field comes from A but should
        // only appear once.
        const aFieldFromA = field('a', scalarType('boolean'));
        const aOverrideFromC = field('a', scalarType('boolean'), { description: 'overridden in C' });
        const idx = buildModelIndex([
            model('A', [aFieldFromA]),
            model('B', [field('b', scalarType('int'))], { bases: ['A'] }),
            model('C', [aOverrideFromC], { bases: ['A'] }),
            model('D', [], { bases: ['B', 'C'] }),
        ]);
        const result = resolveEffectiveFields('D', idx);
        // `a`, `b` — `a` once, with C's override winning (last seen)
        expect(result.fields.map(f => f.name)).toEqual(['a', 'b']);
        const a = result.fields.find(f => f.name === 'a')!;
        expect(a.description).toBe('overridden in C');
    });

    it('captures unresolved refs from missing bases', () => {
        const idx = buildModelIndex([
            model('BusinessPagination',
                [field('extra', scalarType('int'))],
                { bases: ['Pagination'] },
            ),
        ]);
        const result = resolveEffectiveFields('BusinessPagination', idx);
        expect(result.fields.map(f => f.name)).toEqual(['extra']);
        expect(result.unresolved).toEqual(['Pagination']);
    });

    it('flattens an inline intersection passed as a type argument', () => {
        const idx = buildModelIndex([
            model('A', [field('a', scalarType('boolean'))]),
            model('B', [field('b', scalarType('int'))]),
        ]);
        const result = resolveEffectiveFields(
            { kind: 'intersection', members: [refType('A'), refType('B'), inlineObjectType([field('c', scalarType('string'))])] },
            idx,
        );
        expect(result.fields.map(f => f.name)).toEqual(['a', 'b', 'c']);
    });

    it('survives cycles without infinite recursion', () => {
        const idx = buildModelIndex([
            model('A', [field('a', scalarType('boolean'))], { bases: ['B'] }),
            model('B', [field('b', scalarType('int'))], { bases: ['A'] }),
        ]);
        const result = resolveEffectiveFields('A', idx);
        // Both fields appear once; resolution doesn't hang.
        const names = result.fields.map(f => f.name).sort();
        expect(names).toEqual(['a', 'b']);
    });

    it('returns empty fields (not null) for shapes that can\'t produce fields', () => {
        const idx = buildModelIndex([]);
        const result = resolveEffectiveFields(scalarType('string'), idx);
        expect(result.fields).toEqual([]);
        expect(result.unresolved).toEqual([]);
    });

    it('handles bases that are type aliases to a single ref', () => {
        // Sometimes a contract aliases another contract by name.
        const idx = buildModelIndex([
            model('Real', [field('x', scalarType('int'))]),
            model('Alias', [], { type: refType('Real') }),
            model('Foo', [field('y', scalarType('string'))], { bases: ['Alias'] }),
        ]);
        const result = resolveEffectiveFields('Foo', idx);
        expect(result.fields.map(f => f.name)).toEqual(['x', 'y']);
    });
});
