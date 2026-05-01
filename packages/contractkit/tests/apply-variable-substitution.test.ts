import { describe, it, expect } from 'vitest';
import { parseCk } from '../src/parser.js';
import { applyVariableSubstitution } from '../src/apply-variable-substitution.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import type { CkRootNode } from '../src/ast.js';

function substitute(source: string, fallbackKeys?: Record<string, string>): { root: CkRootNode; diag: DiagnosticCollector } {
    const diag = new DiagnosticCollector();
    const root = parseCk(source, 'test.ck', diag);
    applyVariableSubstitution(root, diag, fallbackKeys);
    return { root, diag };
}

describe('applyVariableSubstitution', () => {
    it('substitutes a variable in a plugin value (the canonical case)', () => {
        const { root, diag } = substitute(`options {
    keys: { bruno: "../../bruno" }
}
operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/authentication/request.token.yml" }
        response: { 201: }
    }
}
`);
        expect(diag.hasErrors()).toBe(false);
        expect(diag.getAll()).toHaveLength(0);
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({ bruno: '../../bruno/authentication/request.token.yml' });
    });

    it('substitutes in options.services values', () => {
        const { root } = substitute(`options {
    keys: { mod: "src/modules" }
    services: {
        AuthService: "#{{mod}}/authentication/auth.service.js"
    }
}
operation /x: { get: { response: { 200: } } }
`);
        expect(root.services).toEqual({ AuthService: '#src/modules/authentication/auth.service.js' });
    });

    it('substitutes inside multiple plugin values within one operation', () => {
        const { root } = substitute(`options {
    keys: {
        bruno: "../../bruno"
        area: "auth"
    }
}
operation /auth/token: {
    post: {
        plugins: {
            bruno: "{{bruno}}/{{area}}/request.yml"
            other: "static"
        }
        response: { 201: }
    }
}
`);
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({
            bruno: '../../bruno/auth/request.yml',
            other: 'static',
        });
    });

    it('treats `\\{{name}}` as a literal `{{name}}` and emits no warning', () => {
        const { root, diag } = substitute(String.raw`options {
    keys: { bruno: "../../bruno" }
}
operation /auth/token: {
    post: {
        plugins: { bruno: "\{{bruno}}/literal.yml" }
        response: { 201: }
    }
}
`);
        expect(diag.getAll()).toHaveLength(0);
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({ bruno: '{{bruno}}/literal.yml' });
    });

    it('emits literal `undefined` and a warning for an unknown variable', () => {
        const { root, diag } = substitute(`operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/missing.yml" }
        response: { 201: }
    }
}
`);
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({ bruno: 'undefined/missing.yml' });
        const warns = diag.getAll().filter(d => d.severity === 'warning');
        expect(warns).toHaveLength(1);
        expect(warns[0]!.file).toBe('test.ck');
        expect(warns[0]!.message).toBe(`Unknown variable '{{bruno}}'`);
    });

    it('does not recursively substitute within `options.keys` values themselves', () => {
        const { root } = substitute(`options {
    keys: {
        a: "{{b}}"
        b: "x"
    }
}
operation /x: { get: { response: { 200: } } }
`);
        // `a` keeps its literal value — no recursive expansion
        expect(root.meta).toEqual({ a: '{{b}}', b: 'x' });
    });

    it('substitutes multiple occurrences in a single string', () => {
        const { root } = substitute(`options {
    keys: {
        a: "X"
        b: "Y"
    }
}
operation /x: {
    get: {
        plugins: { bruno: "{{a}}-{{b}}-{{a}}" }
        response: { 200: }
    }
}
`);
        expect(root.routes[0]!.operations[0]!.plugins).toEqual({ bruno: 'X-Y-X' });
    });

    it('is a no-op when no variables and no keys are defined', () => {
        const { diag } = substitute(`operation /x: { get: { response: { 200: } } }
`);
        expect(diag.getAll()).toHaveLength(0);
    });

    it('uses fallbackKeys when options.keys does not define the name', () => {
        const { root, diag } = substitute(
            `operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/from-fallback.yml" }
        response: { 201: }
    }
}
`,
            { bruno: '../../bruno' },
        );
        expect(diag.getAll()).toHaveLength(0);
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({ bruno: '../../bruno/from-fallback.yml' });
    });

    it('prefers options.keys over fallbackKeys when both define a name', () => {
        const { root } = substitute(
            `options {
    keys: { bruno: "file-local" }
}
operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/x.yml" }
        response: { 201: }
    }
}
`,
            { bruno: 'fallback' },
        );
        const op = root.routes[0]!.operations[0]!;
        expect(op.plugins).toEqual({ bruno: 'file-local/x.yml' });
    });
});
