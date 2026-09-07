import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import { collectHoistedTypes } from '../src/hoist.js';
import { contractRoot, enumType, field, inlineObjectType, literalType, model, refType, scalarType, tupleType, unionType } from './helpers.js';
import type { ContractRootNode, ModelNode } from './helpers.js';

/** Hoist across a whole project, the way the plugin does. */
function hoist(roots: ContractRootNode[], modelsWithInput: string[] = [], warn?: (m: string, f: string) => void) {
    const models: ModelNode[] = roots.flatMap(r => r.models);
    return collectHoistedTypes(roots, { modelIndex: buildModelIndex(models), modelsWithInput: new Set(modelsWithInput), warn });
}

describe('anonymous shapes', () => {
    it('names a field-level enum after the model and field that hold it', () => {
        const result = hoist([contractRoot([model('M', [field('status', enumType('a', 'b'))])])]);
        expect([...result.byName.keys()]).toEqual(['MStatus']);
        expect(result.byName.get('MStatus')?.kind).toBe('enum');
    });

    it('names an inline object and recurses into its fields', () => {
        const result = hoist([contractRoot([model('M', [field('meta', inlineObjectType([field('kind', enumType('x', 'y'))]))])])]);
        expect([...result.byName.keys()].sort()).toEqual(['MMeta', 'MMetaKind']);
        expect(result.byName.get('MMeta')?.kind).toBe('struct');
    });

    it('hoists a tuple of every arity, since a Swift tuple is not Codable', () => {
        const result = hoist([
            contractRoot([
                model('M', [
                    field('pair', tupleType(scalarType('int'), scalarType('int'))),
                    field('triple', tupleType(scalarType('int'), scalarType('int'), scalarType('int'))),
                    field('quad', tupleType(scalarType('int'), scalarType('int'), scalarType('int'), scalarType('int'))),
                ]),
            ]),
        ]);
        expect([...result.byName.keys()].sort()).toEqual(['MPair', 'MQuad', 'MTriple']);
        for (const name of ['MPair', 'MTriple', 'MQuad']) expect(result.byName.get(name)?.kind).toBe('tuple');
    });

    it('suffixes a name that collides with a contract, since one module holds them all', () => {
        const result = hoist([contractRoot([model('MStatus', [field('v', scalarType('string'))]), model('M', [field('status', enumType('a'))])])]);
        expect(result.byName.has('MStatus2')).toBe(true);
    });

    it('never takes a name the runtime already uses', () => {
        const result = collectHoistedTypes([contractRoot([model('JSON', [field('value', enumType('a'))])])], {
            modelIndex: new Map(),
            modelsWithInput: new Set(),
            reservedNames: new Set(['JSONValue']),
        });
        expect(result.byName.has('JSONValue')).toBe(false);
        expect(result.byName.has('JSONValue2')).toBe(true);
    });
});

describe('unions', () => {
    it('leaves union(T, null) unhoisted — it is Swift Optional', () => {
        const result = hoist([contractRoot([model('M', [field('v', unionType(refType('Payment'), scalarType('null')))])])]);
        expect(result.byName.size).toBe(0);
    });

    it('turns a union of string literals into an enum rather than a payload enum', () => {
        const result = hoist([contractRoot([model('M', [field('v', unionType(literalType('a'), literalType('b')))])])]);
        expect(result.byName.get('MV')?.kind).toBe('enum');
        expect(result.byName.get('MV')?.values).toEqual(['a', 'b']);
    });

    it('gives a plain union one case per member, labelled by the member', () => {
        const result = hoist([contractRoot([model('M', [field('v', unionType(refType('Payment'), scalarType('string')))])])]);
        const decl = result.byName.get('MV');
        expect(decl?.kind).toBe('plainUnion');
        expect(decl?.members?.map(m => m.caseName)).toEqual(['payment', 'string']);
        expect(decl?.members?.map(m => m.typeName)).toEqual(['Payment', '']);
    });

    it('records the null member so references render as an Optional', () => {
        const result = hoist([contractRoot([model('M', [field('v', unionType(refType('A'), refType('B'), scalarType('null')))])])]);
        expect(result.byName.get('MV')?.nullable).toBe(true);
    });

    it('keeps the model name when a union is the model type itself', () => {
        const result = hoist([contractRoot([model('MV', [], { type: unionType(refType('A'), refType('B')) })])]);
        expect(result.byName.has('MV')).toBe(true);
    });
});

describe('discriminated unions', () => {
    const members = [
        model('Card', [field('kind', literalType('card')), field('last4', scalarType('string'))]),
        model('Bank', [field('kind', literalType('bank'))]),
    ];

    it('dispatches on each member tag, with a case named after it', () => {
        const root = contractRoot([
            ...members,
            model('PaymentMethod', [], { type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] } }),
        ]);
        const decl = hoist([root]).byName.get('PaymentMethod');
        expect(decl?.kind).toBe('discriminatedUnion');
        expect(decl?.discriminator).toBe('kind');
        expect(decl?.members?.map(m => [m.typeName, m.tag, m.caseName])).toEqual([
            ['Card', 'card', 'card'],
            ['Bank', 'bank', 'bank'],
        ]);
    });

    it('warns and degrades when a discriminator is not a literal, since no tag is known at build time', () => {
        const warnings: string[] = [];
        const root = contractRoot([
            model('Card', [field('kind', enumType('card'))]),
            model('PM', [], { type: { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card')] } }),
        ]);
        const result = hoist([root], [], m => warnings.push(m));
        expect(result.byName.has('PM')).toBe(false);
        expect(warnings.join('\n')).toMatch(/not a literal/);
    });
});

describe('across files', () => {
    it('keeps names unique between files, which share one Swift module', () => {
        const a = contractRoot([model('M', [field('status', enumType('a'))])], 'a.ck');
        const b = contractRoot([model('N', [field('status', enumType('b'))])], 'b.ck');
        const result = hoist([a, b]);
        expect([...result.byName.keys()].sort()).toEqual(['MStatus', 'NStatus']);
        expect(result.byFile.get('a.ck')?.map(d => d.name)).toEqual(['MStatus']);
        expect(result.byFile.get('b.ck')?.map(d => d.name)).toEqual(['NStatus']);
    });

    it('marks a hoisted shape as needing an Input twin when it reaches a split model', () => {
        const root = contractRoot([
            model('Cred', [field('secret', scalarType('string'), { visibility: 'writeonly' })]),
            model('M', [field('v', unionType(refType('Cred'), scalarType('string')))]),
        ]);
        const result = hoist([root], ['Cred']);
        expect(result.byName.get('MV')?.needsInput).toBe(true);
    });
});
