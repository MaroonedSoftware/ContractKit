import { generateContract, renderType } from '../src/codegen-contract.js';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import { generateOp } from '../src/codegen-operation.js';
import { renderTsType, escapeJsDocLines, escapeSingleQuoted } from '../src/ts-render.js';
import { computeOpOutPath, computeSdkOutPath, computeSdkTypeOutPath, computeSdkAreaClientOutPath } from '../src/path-utils.js';
import { field, model, contractRoot, enumType, scalarType, opRoot, opRoute, opOperation, opResponse, loc } from './helpers.js';

// ─── Fix 1: JSDoc comment injection via descriptions ────────────────────────

describe('JSDoc comment injection (descriptions)', () => {
    it('neutralizes `*/` in a model description (Zod codegen)', () => {
        const root = contractRoot([model('Widget', [field('id', scalarType('uuid'))], { description: 'closes */ early' })]);
        const out = generateContract(root);
        // The raw terminator must not appear inside the generated comment.
        expect(out).not.toContain('closes */ early');
        expect(out).toContain('closes *\\/ early');
    });

    it('splits a two-line model description into ` * ` continuation lines (Zod codegen)', () => {
        const root = contractRoot([model('Widget', [field('id', scalarType('uuid'))], { description: 'line one\nline two' })]);
        const out = generateContract(root);
        expect(out).toContain(' * line one');
        expect(out).toContain(' * line two');
    });

    it('neutralizes `*/` in a model description (plain-types codegen)', () => {
        const root = contractRoot([model('Widget', [field('id', scalarType('uuid'))], { description: 'closes */ early' })]);
        const out = generatePlainTypes(root);
        expect(out).not.toContain('closes */ early');
        expect(out).toContain('closes *\\/ early');
    });

    it('neutralizes `*/` in a field description (plain-types codegen)', () => {
        const root = contractRoot([model('Widget', [field('id', scalarType('uuid'), { description: 'bad */ desc' })])]);
        const out = generatePlainTypes(root);
        expect(out).not.toContain('bad */ desc');
        expect(out).toContain('bad *\\/ desc');
    });

    it('splits a two-line field description into a multi-line JSDoc block (plain-types codegen)', () => {
        const root = contractRoot([model('Widget', [field('id', scalarType('uuid'), { description: 'first\nsecond' })])]);
        const out = generatePlainTypes(root);
        expect(out).toContain('first');
        expect(out).toContain('* second');
        // No premature close on the same physical line as content.
        expect(out).not.toMatch(/first\nsecond/);
    });

    it('neutralizes `*/` in an operation description (server codegen)', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { description: 'op */ desc', responses: [opResponse(200)] })])]);
        const out = generateOp(root);
        expect(out).not.toContain('op */ desc');
        expect(out).toContain('op *\\/ desc');
    });

    it('escapeJsDocLines neutralizes terminators and splits newlines', () => {
        expect(escapeJsDocLines('a */ b')).toEqual(['a *\\/ b']);
        expect(escapeJsDocLines('a\nb')).toEqual(['a', 'b']);
    });
});

// ─── Fix 2: enum / literal value escaping ───────────────────────────────────

describe('enum value escaping', () => {
    it('escapes double and single quotes in a Zod enum', () => {
        const out = renderType(enumType('a"b', "c'd"));
        expect(out).toBe('z.enum(["a\\"b", "c\'d"])');
    });

    it('escapes single quotes in a TS union of enum values', () => {
        const out = renderTsType(enumType('a"b', "c'd"));
        expect(out).toBe("'a\"b' | 'c\\'d'");
    });

    it('escapes single quotes in a TS string literal', () => {
        expect(renderTsType({ kind: 'literal', value: "it's" })).toBe("'it\\'s'");
    });

    it('escapeSingleQuoted escapes backslashes, quotes and newlines', () => {
        expect(escapeSingleQuoted("a'b\\c\nd")).toBe("a\\'b\\\\c\\nd");
    });
});

// ─── Fix 3: signature interpolation escaping ────────────────────────────────

describe('signature escaping (server codegen)', () => {
    it('escapes a single quote in the signature value', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { signature: "sig'v", responses: [opResponse(200)] })])]);
        const out = generateOp(root);
        expect(out).toContain("requireSignature('sig\\'v')");
    });

    it('escapes single quotes in signature and policy', () => {
        const root = opRoot([
            opRoute('/x', [opOperation('get', { signature: "sig'v", signaturePolicy: "pol'y", responses: [opResponse(200)] })]),
        ]);
        const out = generateOp(root);
        expect(out).toContain("requireSignature('sig\\'v', { policy: 'pol\\'y' })");
    });

    it('escapes a single quote in a security policy name', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { security: { policy: "pol'y", loc: loc() }, responses: [opResponse(200)] })])]);
        const out = generateOp(root);
        expect(out).toContain("requirePolicy({ policy: 'pol\\'y' })");
    });
});

// ─── Fix 4: path traversal via .ck-derived template vars ────────────────────

describe('path traversal containment', () => {
    const base = '/project/out';

    it('throws when a `.ck`-derived {area} escapes the base output dir', () => {
        expect(() =>
            computeOpOutPath('/project/contracts/a.ck', base, '{area}/{filename}.ts', '.ts', '/project/contracts', {
                area: '../../../tmp/x',
            }),
        ).toThrow(/Refusing to emit outside output directory/);
    });

    it('throws when a `.ck`-derived {filename} escapes the base output dir', () => {
        expect(() =>
            computeSdkTypeOutPath('/project/contracts/a.ck', base, '{filename}.ts', '/project/contracts', {
                filename: '../../etc/passwd',
            }),
        ).toThrow(/Refusing to emit outside output directory/);
    });

    it('throws for computeSdkOutPath traversal', () => {
        expect(() =>
            computeSdkOutPath('/project/contracts/a.ck', base, '{area}/{filename}.ts', '/project/contracts', {
                area: '../../../evil',
            }),
        ).toThrow(/Refusing to emit outside output directory/);
    });

    it('throws for computeSdkAreaClientOutPath traversal', () => {
        expect(() => computeSdkAreaClientOutPath('../../../evil', base, '{area}/{filename}.client.ts')).toThrow(
            /Refusing to emit outside output directory/,
        );
    });

    it('allows a normal in-base path', () => {
        const p = computeOpOutPath('/project/contracts/a.ck', base, '{area}/{filename}.ts', '.ts', '/project/contracts', {
            area: 'billing',
        });
        expect(p).toBe('/project/out/billing/a.ts');
    });
});
