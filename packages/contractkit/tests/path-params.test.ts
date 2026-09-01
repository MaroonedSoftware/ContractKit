import { describe, it, expect } from 'vitest';
import { extractPathParams, hasPathParams, toIdentifier } from '../src/path-params.js';

describe('extractPathParams', () => {
    it('reads placeholders in order', () => {
        expect(extractPathParams('/users/{userId}/posts/{postId}')).toEqual(['userId', 'postId']);
    });

    it('reads a name the grammar allows but a `\\w+` pattern misses', () => {
        // The reason this module exists. A hyphen is a valid `identPart`, so `{payment-id}` is a
        // legal contract — but every consumer's own regex skipped it, leaving the braces in the
        // emitted output with nothing reporting the problem.
        expect(extractPathParams('/payments/{payment-id}')).toEqual(['payment-id']);
        expect(extractPathParams('/things/{a.b}/{c$d}/{_e}')).toEqual(['a.b', 'c$d', '_e']);
    });

    it('ignores a placeholder that could not be an identifier', () => {
        expect(extractPathParams('/reports/{2024}')).toEqual([]);
        expect(extractPathParams('/a/{}/b')).toEqual([]);
    });

    it('returns nothing for a path with no placeholders', () => {
        expect(extractPathParams('/users')).toEqual([]);
    });
});

describe('hasPathParams', () => {
    it('answers consistently across repeated calls', () => {
        // Non-global on purpose: a `/g` regex carries `lastIndex` between `.test` calls and would
        // alternate true/false on the same input.
        for (let i = 0; i < 3; i++) expect(hasPathParams('/payments/{payment-id}')).toBe(true);
        for (let i = 0; i < 3; i++) expect(hasPathParams('/payments')).toBe(false);
    });
});

describe('toIdentifier', () => {
    it('leaves an existing identifier untouched', () => {
        // The common case. Anything else here would churn every generated signature.
        for (const name of ['petId', 'id', '_private', '$x', 'a1']) expect(toIdentifier(name)).toBe(name);
    });

    it('camelCases across separators a TypeScript identifier cannot contain', () => {
        expect(toIdentifier('payment-id')).toBe('paymentId');
        expect(toIdentifier('a.b.c')).toBe('aBC');
        expect(toIdentifier('order-item-id')).toBe('orderItemId');
    });

    it('does not lowercase what it keeps', () => {
        // `headerNameToProperty` lowercases every segment, which would turn `petId` into `petid`.
        expect(toIdentifier('pet-Id')).toBe('petId');
    });

    it('prefixes a leading digit, which cannot start an identifier', () => {
        expect(toIdentifier('3d-model')).toBe('_3dModel');
    });

    it('falls back to a bare underscore when nothing usable survives', () => {
        expect(toIdentifier('---')).toBe('_');
    });
});
