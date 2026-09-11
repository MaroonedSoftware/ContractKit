import { describe, it, expect } from 'vitest';
import { typeReachesBigInt } from '../src/bigint-runtime.js';
import {
    scalarType,
    arrayType,
    tupleType,
    recordType,
    enumType,
    literalType,
    unionType,
    discriminatedUnionType,
    intersectionType,
    refType,
    inlineObjectType,
    lazyType,
    field,
} from './helpers.js';

describe('typeReachesBigInt', () => {
    const tainted = new Set(['Ledger']);

    it('is true for a bigint scalar and false for any other', () => {
        expect(typeReachesBigInt(scalarType('bigint'), undefined)).toBe(true);
        expect(typeReachesBigInt(scalarType('int'), undefined)).toBe(false);
        expect(typeReachesBigInt(scalarType('decimal'), undefined)).toBe(false);
    });

    it('answers a ref from the transitive set, not by name', () => {
        expect(typeReachesBigInt(refType('Ledger'), tainted)).toBe(true);
        expect(typeReachesBigInt(refType('User'), tainted)).toBe(false);
        expect(typeReachesBigInt(refType('Ledger'), undefined)).toBe(false);
    });

    it('looks through every container', () => {
        const big = scalarType('bigint');
        expect(typeReachesBigInt(arrayType(big), undefined)).toBe(true);
        expect(typeReachesBigInt(lazyType(refType('Ledger')), tainted)).toBe(true);
        expect(typeReachesBigInt(tupleType(scalarType('string'), big), undefined)).toBe(true);
        expect(typeReachesBigInt(unionType(scalarType('null'), big), undefined)).toBe(true);
        expect(typeReachesBigInt(discriminatedUnionType('kind', refType('User'), refType('Ledger')), tainted)).toBe(true);
        expect(typeReachesBigInt(intersectionType(refType('User'), refType('Ledger')), tainted)).toBe(true);
        expect(typeReachesBigInt(inlineObjectType([field('total', big)]), undefined)).toBe(true);
    });

    it('checks a record value but not its key, which is always a string on the wire', () => {
        expect(typeReachesBigInt(recordType(scalarType('string'), scalarType('bigint')), undefined)).toBe(true);
        expect(typeReachesBigInt(recordType(scalarType('bigint'), scalarType('string')), undefined)).toBe(false);
    });

    it('is false for enums and literals', () => {
        expect(typeReachesBigInt(enumType('a', 'b'), undefined)).toBe(false);
        expect(typeReachesBigInt(literalType(1), undefined)).toBe(false);
    });
});
