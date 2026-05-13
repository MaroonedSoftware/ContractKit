import { describe, expect, it } from 'vitest';
import { renderType } from '../src/render-type.js';
import {
    array,
    discriminated,
    enumT,
    field,
    inlineObj,
    intersection,
    lazy,
    literal,
    model,
    record,
    ref,
    scalar,
    tuple,
    union,
} from './helpers.js';
import type { ResolvedModel } from '../src/types.js';

describe('renderType', () => {
    it('renders scalars with no constraints', () => {
        expect(renderType(scalar('uuid'))).toMatchInlineSnapshot(`"<span class="ce-type-scalar">uuid</span>"`);
    });

    it('renders scalars with constraints', () => {
        expect(renderType(scalar('string', { min: 3, max: 20 }))).toMatchInlineSnapshot(
            `"<span class="ce-type-scalar">string<span class="ce-type-constraint">(min=3, max=20)</span></span>"`,
        );
    });

    it('renders enum', () => {
        expect(renderType(enumT('a', 'b', 'c'))).toMatchInlineSnapshot(
            `"<span class="ce-type-enum">enum(a, b, c)</span>"`,
        );
    });

    it('renders literal strings', () => {
        expect(renderType(literal('hello'))).toMatchInlineSnapshot(
            `"<span class="ce-type-literal">&quot;hello&quot;</span>"`,
        );
    });

    it('renders literal booleans', () => {
        expect(renderType(literal(true))).toMatchInlineSnapshot(`"<span class="ce-type-literal">true</span>"`);
    });

    it('renders unknown refs as bare anchor links', () => {
        expect(renderType(ref('Payment'))).toMatchInlineSnapshot(`"<a class="ce-ref" href="#model-Payment">Payment</a>"`);
    });

    const resolved = (m: ReturnType<typeof model>, filePath = '/test.ck'): ResolvedModel => ({ filePath, model: m });

    it('renders known refs as collapsible details with inline fields and jump-to-source', () => {
        const models = new Map<string, ResolvedModel>([
            ['Payment', resolved(model('Payment', [field('id', scalar('uuid')), field('amount', scalar('number'))]))],
        ]);
        const out = renderType(ref('Payment'), { models });
        expect(out).toContain('<details class="ce-ref-expand">');
        expect(out).toContain('class="ce-ref-name">Payment</span>');
        expect(out).toContain('data-jump-file="/test.ck"');
        expect(out).toContain('data-jump-line=');
        expect(out).not.toContain('data-open-model');
        expect(out).toContain('<code>id</code>');
        expect(out).toContain('<code>amount</code>');
    });

    it('cycle in refs collapses to a static label', () => {
        const models = new Map<string, ResolvedModel>([
            ['Node', resolved(model('Node', [field('child', ref('Node'))]))],
        ]);
        const out = renderType(ref('Node'), { models });
        // outer is expanded; inner self-ref hits the cycle path
        expect(out).toContain('ce-ref-cycle');
        expect(out).toContain('↺');
    });

    it('stops expanding past maxDepth and emits jump-to-source on the collapsed link', () => {
        const models = new Map<string, ResolvedModel>([
            ['A', resolved(model('A', [field('b', ref('B'))]), '/a.ck')],
            ['B', resolved(model('B', [field('c', ref('C'))]), '/b.ck')],
            ['C', resolved(model('C', [field('id', scalar('uuid'))]), '/c.ck')],
        ]);
        const out = renderType(ref('A'), { models, maxDepth: 2 });
        // Should expand A → B but stop short of expanding C (renders as a plain link with jump-to-source).
        expect(out).toContain('ce-ref-name">A');
        expect(out).toContain('ce-ref-name">B');
        expect(out).not.toContain('ce-ref-name">C');
        expect(out).toContain('data-jump-file="/c.ck"');
    });

    it('renders arrays', () => {
        expect(renderType(array(scalar('int')))).toMatchInlineSnapshot(
            `"<span class="ce-type-token">Array&lt;</span><span class="ce-type-scalar">int</span><span class="ce-type-token">&gt;</span>"`,
        );
    });

    it('renders tuples', () => {
        expect(renderType(tuple(scalar('int'), scalar('string')))).toMatchInlineSnapshot(
            `"<span class="ce-type-token">[</span><span class="ce-type-scalar">int</span><span class="ce-type-token">, </span><span class="ce-type-scalar">string</span><span class="ce-type-token">]</span>"`,
        );
    });

    it('renders records', () => {
        expect(renderType(record(scalar('string'), scalar('int')))).toMatchInlineSnapshot(
            `"<span class="ce-type-token">Record&lt;</span><span class="ce-type-scalar">string</span><span class="ce-type-token">, </span><span class="ce-type-scalar">int</span><span class="ce-type-token">&gt;</span>"`,
        );
    });

    it('renders unions', () => {
        expect(renderType(union(scalar('int'), scalar('string')))).toMatchInlineSnapshot(
            `"<span class="ce-type-scalar">int</span><span class="ce-type-token"> | </span><span class="ce-type-scalar">string</span>"`,
        );
    });

    it('renders discriminated unions', () => {
        expect(renderType(discriminated('kind', ref('A'), ref('B')))).toMatchInlineSnapshot(
            `"<span class="ce-type-token">Union by kind:</span> <a class="ce-ref" href="#model-A">A</a><span class="ce-type-token"> | </span><a class="ce-ref" href="#model-B">B</a>"`,
        );
    });

    it('renders intersections', () => {
        expect(renderType(intersection(ref('A'), ref('B')))).toMatchInlineSnapshot(
            `"<a class="ce-ref" href="#model-A">A</a><span class="ce-type-token"> &amp; </span><a class="ce-ref" href="#model-B">B</a>"`,
        );
    });

    it('renders lazy', () => {
        expect(renderType(lazy(ref('Self')))).toMatchInlineSnapshot(
            `"<span class="ce-type-token">Lazy&lt;</span><a class="ce-ref" href="#model-Self">Self</a><span class="ce-type-token">&gt;</span>"`,
        );
    });

    it('renders inline objects with collapsible details', () => {
        const out = renderType(inlineObj([field('id', scalar('uuid')), field('count', scalar('int'))]));
        expect(out).toContain('<details');
        expect(out).toContain('class="ce-fields"');
        expect(out).toContain('<code>id</code>');
        expect(out).toContain('<code>count</code>');
    });

    it('escapes HTML in literal strings', () => {
        expect(renderType(literal('<script>'))).toContain('&lt;script&gt;');
    });
});
