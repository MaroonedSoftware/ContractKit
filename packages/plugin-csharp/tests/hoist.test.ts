import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import type { ContractRootNode } from '@contractkit/core';
import { collectHoistedTypes } from '../src/hoist.js';
import { contractRoot, enumType, field, inlineObjectType, literalType, model, refType, scalarType, tupleType, unionType } from './helpers.js';

function hoist(roots: ContractRootNode[], modelsWithInput = new Set<string>(), warn?: (m: string, f: string) => void) {
    return collectHoistedTypes(roots, { modelIndex: buildModelIndex(roots.flatMap(r => r.models)), modelsWithInput, warn });
}

describe('collectHoistedTypes', () => {
    it('names an inline enum after the model and field that hold it', () => {
        const result = hoist([contractRoot([model('M', [field('status', enumType('a', 'b'))])])]);
        expect(result.byName.get('MStatus')?.kind).toBe('enum');
    });

    it('names an inline object as a record', () => {
        const result = hoist([contractRoot([model('M', [field('nested', inlineObjectType([field('a', scalarType('string'))]))])])]);
        expect(result.byName.get('MNested')?.kind).toBe('record');
    });

    it('hoists a 2-tuple, which the Kotlin plugin maps onto Pair instead', () => {
        const result = hoist([contractRoot([model('M', [field('coords', tupleType(scalarType('int'), scalarType('int')))])])]);
        expect(result.byName.get('MCoords')?.kind).toBe('tuple');
    });

    it('leaves a union of one non-null member alone, since that is just a nullable type', () => {
        const result = hoist([contractRoot([model('M', [field('v', unionType(scalarType('string'), scalarType('null')))])])]);
        expect(result.byName.has('MV')).toBe(false);
    });

    it('records a membership so a member record declares the union it belongs to', () => {
        const result = hoist([
            contractRoot([
                model('Card', [field('kind', literalType('card'))]),
                model('M', [field('m', { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card')] })]),
            ]),
        ]);
        expect(result.memberships.get('Card')).toEqual(['MM']);
    });

    it('lets one contract belong to two unions, which a record base could not express', () => {
        const result = hoist([
            contractRoot([
                model('Card', [field('kind', literalType('card'))]),
                model('A', [field('m', { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card')] })]),
                model('B', [field('m', { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card')] })]),
            ]),
        ]);
        expect(result.memberships.get('Card')).toEqual(['AM', 'BM']);
    });

    it('suffixes a name already claimed by a model', () => {
        const result = hoist([contractRoot([model('MStatus', [field('x', scalarType('string'))]), model('M', [field('status', enumType('a'))])])]);
        expect(result.byName.has('MStatus2')).toBe(true);
    });

    it('warns and hoists nothing when a discriminator is not a literal', () => {
        const warnings: string[] = [];
        const result = hoist(
            [
                contractRoot([
                    model('Card', [field('kind', enumType('card'))]),
                    model('M', [field('m', { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card')] })]),
                ]),
            ],
            new Set(),
            m => warnings.push(m),
        );
        expect(result.byName.has('MM')).toBe(false);
        expect(warnings.join('\n')).toMatch(/is not a literal/);
    });

    it('marks a hoisted shape as needing an Input twin when it reaches a split model', () => {
        const roots = [
            contractRoot([
                model('P', [field('id', scalarType('uuid'), { visibility: 'readonly' })]),
                model('M', [field('nested', inlineObjectType([field('p', refType('P'))]))]),
            ]),
        ];
        const result = hoist(roots, new Set(['P']));
        expect(result.byName.get('MNested')?.needsInput).toBe(true);
    });

    it('assigns a declaration to the file that owns it, so each models file emits its own', () => {
        const a = contractRoot([model('A', [field('s', enumType('x'))])], 'a.ck');
        const b = contractRoot([model('B', [field('s', enumType('y'))])], 'b.ck');
        const result = hoist([a, b]);
        expect(result.byFile.get('a.ck')?.map(d => d.name)).toEqual(['AS']);
        expect(result.byFile.get('b.ck')?.map(d => d.name)).toEqual(['BS']);
    });
});
