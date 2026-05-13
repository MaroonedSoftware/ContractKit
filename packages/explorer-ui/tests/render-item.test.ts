import { describe, expect, it } from 'vitest';
import { operationId, renderItemPage } from '../src/render-item.js';
import type { PreviewData } from '../src/types.js';
import { field, model, op, ref, resolvedModel, resolvedOp, scalar } from './helpers.js';

describe('renderItemPage', () => {
    const data: PreviewData = {
        configMeta: { title: 'Test API', version: '1.0.0', description: 'demo' },
        operations: [resolvedOp('/payments', op('get', { sdk: 'listPayments' }))],
        models: [resolvedModel(model('Payment', [field('id', scalar('uuid'))]))],
        warnings: [],
    };

    it('renders the overview view with stats and hint', () => {
        const html = renderItemPage(data, { kind: 'overview' });
        expect(html).toContain('class="ce-detail ce-detail-single"');
        expect(html).toContain('Test API');
        expect(html).toContain('v1.0.0');
        expect(html).toContain('class="ce-stats"');
        expect(html).toContain('Endpoints');
        expect(html).toContain('Models');
        expect(html).toContain('Pick an endpoint or model');
    });

    it('renders an operation view by id', () => {
        const id = operationId(data.operations[0]!);
        const html = renderItemPage(data, { kind: 'operation', id });
        expect(html).toContain('class="ce-method ce-method-get"');
        expect(html).toContain('/payments');
        expect(html).not.toContain('class="ce-sidebar"');
    });

    it('shows a missing-item message when the operation is not found', () => {
        const html = renderItemPage(data, { kind: 'operation', id: 'op-nope' });
        expect(html).toContain('ce-missing');
        expect(html).toContain('Operation');
    });

    it('renders a model view by name', () => {
        const html = renderItemPage(data, { kind: 'model', name: 'Payment' });
        expect(html).toContain('id="model-Payment"');
        expect(html).toContain('<code>id</code>');
    });

    it('shows a missing-item message when the model is not found', () => {
        const html = renderItemPage(data, { kind: 'model', name: 'Ghost' });
        expect(html).toContain('ce-missing');
        expect(html).toContain('Model');
    });
});
