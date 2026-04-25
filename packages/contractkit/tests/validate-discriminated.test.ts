import { describe, it, expect } from 'vitest';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import { validateRefs } from '../src/validate-refs.js';

function parseAndValidate(source: string) {
    const diag = new DiagnosticCollector();
    const root = parseCk(source, 'test.ck', diag);
    validateRefs([root], [], diag);
    return diag;
}

describe('discriminated union validation', () => {
    it('passes when all members carry the discriminator as a literal field', () => {
        const diag = parseAndValidate(`
            contract Card: { kind: literal("card"), last4: string }
            contract Bank: { kind: literal("bank"), accountId: string }
            contract Method: discriminated(by=kind, Card | Bank)
        `);
        expect(diag.getAll().filter(d => d.message.includes('discriminat'))).toHaveLength(0);
    });

    it('warns when a member is missing the discriminator field', () => {
        const diag = parseAndValidate(`
            contract Card: { kind: literal("card"), last4: string }
            contract Bank: { accountId: string }
            contract Method: discriminated(by=kind, Card | Bank)
        `);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('Bank') && w.message.includes('kind'))).toBe(true);
    });

    it('warns when the discriminator field is not a literal or enum', () => {
        const diag = parseAndValidate(`
            contract Card: { kind: string, last4: string }
            contract Bank: { kind: literal("bank"), accountId: string }
            contract Method: discriminated(by=kind, Card | Bank)
        `);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('Card') && w.message.includes('literal or enum'))).toBe(true);
    });

    it('accepts enum-typed discriminators', () => {
        const diag = parseAndValidate(`
            contract Card: { kind: enum(card), last4: string }
            contract Bank: { kind: enum(bank), accountId: string }
            contract Method: discriminated(by=kind, Card | Bank)
        `);
        expect(diag.getAll().filter(d => d.message.includes('discriminat'))).toHaveLength(0);
    });

    it('warns when discriminated() has fewer than 2 members', () => {
        const diag = parseAndValidate(`
            contract Card: { kind: literal("card") }
            contract Method: discriminated(by=kind, Card)
        `);
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings.some(w => w.message.includes('at least 2'))).toBe(true);
    });
});
