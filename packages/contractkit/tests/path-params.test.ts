import { describe, it, expect } from 'vitest';
import { extractPathParams, hasPathParams } from '../src/path-params.js';

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
