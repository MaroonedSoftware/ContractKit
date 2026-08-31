import { describe, expect, it } from 'vitest';
import { computeModelsWithCaseTransform, computeModelsWithOutput } from '../src/index.js';
import { arrayType, field, model, refType, scalarType } from './helpers.js';

describe('computeModelsWithCaseTransform', () => {
    const plain = (name: string) => model(name, [field('id', scalarType('uuid'))]);

    it('returns an empty set when no model declares a format()', () => {
        expect(computeModelsWithCaseTransform([plain('User'), plain('Team')])).toEqual(new Set());
    });

    it('seeds from format(output=...)', () => {
        const models = [model('AuthToken', [field('accessToken', scalarType('string'))], { outputCase: 'snake' })];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['AuthToken']));
    });

    // The whole reason this exists alongside computeModelsWithOutput: `format(input=...)` alone
    // still compiles to a transform pipe, but needs no `Output` type alias, so the narrower set
    // never sees it.
    it('seeds from format(input=...) alone, where computeModelsWithOutput does not', () => {
        const models = [model('User', [field('userId', scalarType('uuid'))], { inputCase: 'snake' })];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['User']));
        expect(computeModelsWithOutput(models)).toEqual(new Set());
    });

    it('ignores an explicit camel format(), which is the identity', () => {
        const models = [model('User', [field('id', scalarType('uuid'))], { inputCase: 'camel', outputCase: 'camel' })];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set());
    });

    it('closes transitively through a field ref', () => {
        const models = [
            model('AuthToken', [field('accessToken', scalarType('string'))], { outputCase: 'snake' }),
            model('Session', [field('token', refType('AuthToken'))]),
            model('Envelope', [field('session', refType('Session'))]),
        ];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['AuthToken', 'Session', 'Envelope']));
    });

    it('closes through a ref nested in an array', () => {
        const models = [
            model('Row', [field('col', scalarType('string'))], { inputCase: 'snake' }),
            model('Page', [field('rows', arrayType(refType('Row')))]),
        ];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['Row', 'Page']));
    });

    it('closes through bases', () => {
        const models = [
            model('Base', [field('id', scalarType('uuid'))], { inputCase: 'pascal' }),
            model('Derived', [field('name', scalarType('string'))], { bases: ['Base'] }),
        ];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['Base', 'Derived']));
    });

    it('closes through a type alias', () => {
        const models = [
            model('Row', [field('col', scalarType('string'))], { outputCase: 'snake' }),
            model('Rows', [], { type: arrayType(refType('Row')) }),
        ];
        expect(computeModelsWithCaseTransform(models)).toEqual(new Set(['Row', 'Rows']));
    });

    it('picks up refs to models declared in another file', () => {
        const models = [model('Session', [field('token', refType('AuthToken'))])];
        expect(computeModelsWithCaseTransform(models, new Set(['AuthToken']))).toEqual(new Set(['Session']));
    });
});
