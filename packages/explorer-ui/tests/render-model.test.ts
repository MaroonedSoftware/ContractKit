import { describe, expect, it } from 'vitest';
import { modelAnchor, renderFieldRows, renderModel } from '../src/render-model.js';
import { field, model, resolvedModel, scalar } from './helpers.js';

describe('renderModel', () => {
    it('produces a model card with header anchor and field table', () => {
        const html = renderModel(
            resolvedModel(
                model('Payment', [field('id', scalar('uuid')), field('amount', scalar('number'))]),
            ),
        );
        expect(html).toContain(`id="${modelAnchor('Payment')}"`);
        expect(html).toContain('<h2');
        expect(html).toContain('Payment');
        expect(html).toContain('<code>id</code>');
        expect(html).toContain('<code>amount</code>');
        expect(html).toContain('data-jump-file="/test.ck"');
    });

    it('renders inheritance line with anchor links', () => {
        const html = renderModel(
            resolvedModel(model('Sub', [field('extra', scalar('int'))], { bases: ['Base1', 'Base2'] })),
        );
        expect(html).toContain('class="ce-extends"');
        expect(html).toContain('href="#model-Base1"');
        expect(html).toContain('href="#model-Base2"');
    });

    it('renders deprecated/mode/format badges', () => {
        const html = renderModel(
            resolvedModel(
                model('M', [], { deprecated: true, mode: 'strict', inputCase: 'snake', outputCase: 'camel' }),
            ),
        );
        expect(html).toContain('ce-badge-deprecated');
        expect(html).toContain('mode=strict');
        expect(html).toContain('format(input=snake)');
        expect(html).toContain('format(output=camel)');
    });

    it('renders field modifier badges', () => {
        const html = renderFieldRows([
            field('x', scalar('int'), { optional: true, nullable: true, visibility: 'readonly', deprecated: true }),
        ]);
        expect(html).toContain('ce-badge-optional');
        expect(html).toContain('ce-badge-nullable');
        expect(html).toContain('ce-badge-readonly');
        expect(html).toContain('ce-badge-deprecated');
    });

    it('handles empty field tables', () => {
        const html = renderFieldRows([]);
        expect(html).toContain('No fields.');
    });

    it('renders type alias when model.type is set', () => {
        const html = renderModel(resolvedModel(model('Alias', [], { type: scalar('uuid') })));
        expect(html).toContain('ce-type-alias');
        expect(html).toContain('uuid');
    });
});
