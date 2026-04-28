import { describe, it, expect } from 'vitest';
import { parseCk } from '../src/parser.js';
import { validateInheritance, fieldsAreIdentical } from '../src/validate-inheritance.js';
import { decomposeCk } from '../src/decompose.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import type { CkRootNode } from '../src/ast.js';

function compile(source: string): { root: CkRootNode; diag: DiagnosticCollector } {
    const diag = new DiagnosticCollector();
    const root = parseCk(source, 'test.ck', diag);
    const { contract } = decomposeCk(root);
    validateInheritance([contract], diag);
    return { root, diag };
}

const errors = (diag: DiagnosticCollector): string[] => diag.getAll().filter(d => d.severity === 'error').map(d => d.message);

describe('validateInheritance — single-base sanity', () => {
    it('passes when child redeclares no fields', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: A & { y: int }
`);
        expect(errors(diag)).toHaveLength(0);
    });

    it('passes when child has no override and no conflict', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: A & { y: int }
`);
        expect(errors(diag)).toHaveLength(0);
    });

    it('errors when override is used without a matching base field', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: A & { z: override int }
`);
        expect(errors(diag).some(e => e.includes("'z' has 'override'"))).toBe(true);
    });
});

describe('validateInheritance — multi-base conflicts', () => {
    it('errors when two bases declare same field with different types and no override', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: { x: int }
contract C: A & B & { y: string }
`);
        expect(errors(diag).some(e => e.includes("Field 'x' is declared by 'A' and 'B'"))).toBe(true);
    });

    it('errors when conflicting field is redeclared without override', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: { x: int }
contract C: A & B & { x: int }
`);
        expect(errors(diag).some(e => e.includes("conflicts across bases") && e.includes("'A' and 'B'"))).toBe(true);
    });

    it('passes when conflicting field is redeclared with override', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: { x: int }
contract C: A & B & { x: override int }
`);
        expect(errors(diag)).toHaveLength(0);
    });

    it('passes when bases declare identical fields (no real conflict)', () => {
        const { diag } = compile(`
contract A: { x: string }
contract B: { x: string }
contract C: A & B & { y: int }
`);
        expect(errors(diag)).toHaveLength(0);
    });

    it('counts visibility difference as a conflict', () => {
        const { diag } = compile(`
contract A: { x: readonly string }
contract B: { x: string }
contract C: A & B & {}
`);
        expect(errors(diag).some(e => e.includes("Field 'x'"))).toBe(true);
    });

    it('counts default difference as a conflict', () => {
        const { diag } = compile(`
contract A: { x: string = "a" }
contract B: { x: string = "b" }
contract C: A & B & {}
`);
        expect(errors(diag).some(e => e.includes("Field 'x'"))).toBe(true);
    });

    it('counts optional difference as a conflict', () => {
        const { diag } = compile(`
contract A: { x?: string }
contract B: { x: string }
contract C: A & B & {}
`);
        expect(errors(diag).some(e => e.includes("Field 'x'"))).toBe(true);
    });
});

describe('validateInheritance — diamond / transitive', () => {
    it('deduplicates a base reachable via multiple paths', () => {
        const { diag } = compile(`
contract X: { x: string }
contract A: X & { a: int }
contract B: X & { b: int }
contract D: A & B & {}
`);
        // X.x is identical via both paths — should NOT be flagged.
        expect(errors(diag)).toHaveLength(0);
    });

    it('transitive override survives in the chain', () => {
        // B overrides X.x; D extends B — no conflict.
        const { diag } = compile(`
contract X: { x: string }
contract B: X & { x: override int }
contract D: B & {}
`);
        expect(errors(diag)).toHaveLength(0);
    });
});

describe('validateInheritance — cycles', () => {
    it('detects a direct two-node cycle and errors once', () => {
        const { diag } = compile(`
contract A: B & {}
contract B: A & {}
`);
        const cycleErrs = errors(diag).filter(e => e.includes('Inheritance cycle'));
        expect(cycleErrs.length).toBeGreaterThan(0);
    });

    it('detects a three-node cycle', () => {
        const { diag } = compile(`
contract A: B & {}
contract B: C & {}
contract C: A & {}
`);
        expect(errors(diag).some(e => e.includes('Inheritance cycle'))).toBe(true);
    });
});

describe('fieldsAreIdentical', () => {
    it('ignores description differences', () => {
        const a = { name: 'x', optional: false, nullable: false, visibility: 'normal', type: { kind: 'scalar', name: 'string' }, loc: { file: 'a', line: 1 }, description: 'hello' } as never;
        const b = { name: 'x', optional: false, nullable: false, visibility: 'normal', type: { kind: 'scalar', name: 'string' }, loc: { file: 'b', line: 99 } } as never;
        expect(fieldsAreIdentical(a, b)).toBe(true);
    });

    it('detects differing scalar constraints', () => {
        const a = { name: 'x', optional: false, nullable: false, visibility: 'normal', type: { kind: 'scalar', name: 'string', min: 1 }, loc: { file: 'a', line: 1 } } as never;
        const b = { name: 'x', optional: false, nullable: false, visibility: 'normal', type: { kind: 'scalar', name: 'string', min: 2 }, loc: { file: 'b', line: 1 } } as never;
        expect(fieldsAreIdentical(a, b)).toBe(false);
    });
});
