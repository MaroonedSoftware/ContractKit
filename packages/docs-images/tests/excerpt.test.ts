import { describe, expect, it } from 'vitest';
import { dedent, excerpt } from '../src/excerpt.ts';

const AUTH = 'contracts/examples/identity/auth.ck';

describe('excerpt', () => {
    it('slices from the start anchor to the end anchor, inclusive', () => {
        const { code, firstLine } = excerpt(AUTH, 'contract Auditable: {', /^\}$/);
        expect(code.split('\n').at(0)).toBe('contract Auditable: {');
        expect(code.split('\n').at(-1)).toBe('}');
        expect(firstLine).toBeGreaterThan(1);
    });

    it('reports the source line so the figure gutter matches the real file', () => {
        const { code, firstLine } = excerpt(AUTH, 'contract Auditable: {', /^\}$/);
        const file = excerpt(AUTH, 'options {', /^\}$/).code;
        expect(file.length).toBeGreaterThan(0);
        expect(code.split('\n').length).toBeGreaterThan(2);
        expect(Number.isInteger(firstLine)).toBe(true);
    });

    it('spans several declarations via the end occurrence', () => {
        const one = excerpt(AUTH, 'contract Auditable: {', /^\}$/, 1);
        const three = excerpt(AUTH, 'contract Auditable: {', /^\}$/, 3);
        expect(three.code.split('\n').length).toBeGreaterThan(one.code.split('\n').length);
        expect(three.code).toContain('contract Admin:');
    });

    // A figure rendering the wrong lines is worse than one that fails to render, so a stale
    // anchor has to be loud.
    it('throws when an anchor no longer matches', () => {
        expect(() => excerpt(AUTH, 'contract ThisWasRenamed: {', /^\}$/)).toThrow(/no line matching/);
        expect(() => excerpt(AUTH, 'contract Auditable: {', /^\}$/, 99)).toThrow(/fewer than 99/);
    });

    it('dedents a nested block to the left margin', () => {
        expect(dedent('    get: {\n        sdk: list\n    }')).toBe('get: {\n    sdk: list\n}');
    });
});
