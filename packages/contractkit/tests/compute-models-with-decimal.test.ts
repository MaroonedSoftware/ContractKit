import { describe, expect, it } from 'vitest';
import { computeModelsWithDecimal } from '../src/index.js';
import { arrayType, field, inlineObjectType, model, recordType, refType, scalarType, unionType } from './helpers.js';

describe('computeModelsWithDecimal', () => {
    const plain = (name: string) => model(name, [field('id', scalarType('uuid'))]);

    it('returns an empty set when no model uses a decimal', () => {
        expect(computeModelsWithDecimal([plain('User'), plain('Team')])).toEqual(new Set());
    });

    it('seeds from a direct decimal field', () => {
        const models = [model('Payslip', [field('gross', scalarType('decimal'))])];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Payslip']));
    });

    it('seeds from a type alias', () => {
        const models = [model('Money', [], { type: scalarType('decimal') })];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Money']));
    });

    it('finds a decimal nested inside composite types', () => {
        const models = [
            model('A', [field('xs', arrayType(scalarType('decimal')))]),
            model('B', [field('m', recordType(scalarType('string'), scalarType('decimal')))]),
            model('C', [field('u', unionType(scalarType('string'), scalarType('decimal')))]),
            model('D', [field('o', inlineObjectType([field('amount', scalarType('decimal'))]))]),
        ];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['A', 'B', 'C', 'D']));
    });

    // The point of the transitive closure: one decimal anywhere below a model taints the whole
    // model, because the SDK has to rehydrate it before a consumer touches the outer object.
    it('propagates through a model reference', () => {
        const models = [model('Money', [field('amount', scalarType('decimal'))]), model('Invoice', [field('total', refType('Money'))]), plain('User')];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Money', 'Invoice']));
    });

    it('propagates through a chain of references, in either declaration order', () => {
        const models = [
            model('Invoice', [field('line', refType('LineItem'))]),
            model('LineItem', [field('price', refType('Money'))]),
            model('Money', [field('amount', scalarType('decimal'))]),
        ];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Money', 'LineItem', 'Invoice']));
    });

    it('propagates through inheritance', () => {
        const models = [model('Base', [field('amount', scalarType('decimal'))]), model('Child', [field('id', scalarType('uuid'))], { bases: ['Base'] })];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Base', 'Child']));
    });

    it('terminates on a self-referential model', () => {
        const models = [model('Category', [field('subtotal', scalarType('decimal')), field('children', arrayType(refType('Category')))])];
        expect(computeModelsWithDecimal(models)).toEqual(new Set(['Category']));
    });

    it('picks up a decimal reached only through an external model', () => {
        const models = [model('Invoice', [field('total', refType('Money'))])];
        expect(computeModelsWithDecimal(models, new Set(['Money']))).toEqual(new Set(['Invoice']));
    });
});
