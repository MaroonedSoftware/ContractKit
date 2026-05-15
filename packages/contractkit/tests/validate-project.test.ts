import { describe, expect, it } from 'vitest';
import { validateProject } from '../src/validate-project.js';

const errors = (diag: ReturnType<typeof validateProject>['diag']): string[] =>
    diag.getAll().filter(d => d.severity === 'error').map(d => d.message);
const messages = (diag: ReturnType<typeof validateProject>['diag']): string[] => diag.getAll().map(d => d.message);

describe('validateProject', () => {
    it('returns decomposed contracts and ops with no errors on a valid project', () => {
        const result = validateProject({
            files: [
                { filePath: 'a.ck', source: `contract User: { id: string, name: string }` },
                { filePath: 'b.ck', source: `operation /users: { get: { response: { 200: { application/json: User } } } }` },
            ],
        });
        expect(errors(result.diag)).toHaveLength(0);
        expect(result.contracts).toHaveLength(1);
        expect(result.ops).toHaveLength(1);
        expect(result.asts).toHaveLength(2);
    });

    it('surfaces cross-file ref errors (unknown model)', () => {
        const result = validateProject({
            files: [{ filePath: 'b.ck', source: `operation /users: { get: { response: { 200: { application/json: GhostModel } } } }` }],
        });
        const msgs = messages(result.diag);
        expect(msgs.some(m => /GhostModel/.test(m))).toBe(true);
    });

    it('aggregates diagnostics from multiple files', () => {
        const result = validateProject({
            files: [
                { filePath: 'a.ck', source: `operation /a: { get: { response: { 200: { application/json: Missing1 } } } }` },
                { filePath: 'b.ck', source: `operation /b: { get: { response: { 200: { application/json: Missing2 } } } }` },
            ],
        });
        const msgs = messages(result.diag);
        expect(msgs.some(m => /Missing1/.test(m))).toBe(true);
        expect(msgs.some(m => /Missing2/.test(m))).toBe(true);
    });

    it('accepts pre-parsed ASTs without reparsing', () => {
        const initial = validateProject({
            files: [{ filePath: 'a.ck', source: `contract User: { id: string }` }],
        });
        const reused = validateProject({
            files: [{ filePath: 'a.ck', ast: initial.asts[0]!.ast }],
        });
        expect(errors(reused.diag)).toHaveLength(0);
        expect(reused.contracts).toHaveLength(1);
    });

    it('substitutes fallbackKeys into {{var}} placeholders', () => {
        const result = validateProject({
            files: [
                {
                    filePath: 'a.ck',
                    source: `options { services: { Foo: "{{api}}/foo" } }\noperation /x: { get: { response: { 200: } } }`,
                },
            ],
            fallbackKeys: { api: 'https://example.com' },
        });
        expect(errors(result.diag)).toHaveLength(0);
        expect(result.asts[0]!.ast.services?.Foo).toBe('https://example.com/foo');
    });

    it('honors per-file fallbackKeys via getKeysForFile', () => {
        const result = validateProject({
            files: [
                {
                    filePath: '/projects/payments/contracts/a.ck',
                    source: `options { services: { Foo: "{{api}}/a" } }\noperation /a: { get: { response: { 200: } } }`,
                },
                {
                    filePath: '/projects/billing/contracts/b.ck',
                    source: `options { services: { Bar: "{{api}}/b" } }\noperation /b: { get: { response: { 200: } } }`,
                },
            ],
            getKeysForFile: filePath =>
                filePath.includes('/payments/') ? { api: 'https://payments.example.com' } : { api: 'https://billing.example.com' },
        });
        expect(errors(result.diag)).toHaveLength(0);
        const a = result.asts.find(x => x.filePath.includes('/payments/'));
        const b = result.asts.find(x => x.filePath.includes('/billing/'));
        expect(a?.ast.services?.Foo).toBe('https://payments.example.com/a');
        expect(b?.ast.services?.Bar).toBe('https://billing.example.com/b');
    });

    it('falls back to fallbackKeys when getKeysForFile returns undefined', () => {
        const result = validateProject({
            files: [
                {
                    filePath: '/known.ck',
                    source: `options { services: { Foo: "{{api}}/x" } }\noperation /x: { get: { response: { 200: } } }`,
                },
            ],
            fallbackKeys: { api: 'https://fallback.example.com' },
            getKeysForFile: () => undefined,
        });
        expect(errors(result.diag)).toHaveLength(0);
        expect(result.asts[0]!.ast.services?.Foo).toBe('https://fallback.example.com/x');
    });
});
