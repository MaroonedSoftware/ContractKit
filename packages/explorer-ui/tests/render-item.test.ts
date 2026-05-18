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

    it('renders endpoints grouped by area on the overview', () => {
        const grouped: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: [
                resolvedOp('/payments', op('get', { sdk: 'listPayments', name: 'List payments' }), { fileGroup: 'payments' }),
                resolvedOp('/payments/{id}', op('get', { sdk: 'getPayment' }), { fileGroup: 'payments' }),
                resolvedOp('/customers', op('post', { sdk: 'createCustomer' }), { fileGroup: 'customers' }),
            ],
            models: [],
            warnings: [],
        };
        const html = renderItemPage(grouped, { kind: 'overview' });
        expect(html).toContain('class="ce-overview-area"');
        expect(html).toContain('payments');
        expect(html).toContain('customers');
        expect(html).toContain('data-open-operation=');
        expect(html).toContain('class="ce-method ce-method-get"');
        expect(html).toContain('class="ce-method ce-method-post"');
        // Human-readable name shows next to the path when present
        expect(html).toContain('class="ce-overview-endpoint-name">List payments<');
        // ≤3 areas → all start open
        expect(html).toContain('<details class="ce-overview-area" open>');
        // Area count badge reflects ops in that area
        expect(html).toMatch(/class="ce-overview-area-count">2</);
    });

    it('sorts endpoints within each area by path then method', () => {
        const unordered: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: [
                resolvedOp('/payments/{id}', op('patch', { sdk: 'patchPayment' }), { fileGroup: 'payments' }),
                resolvedOp('/payments/{id}', op('get', { sdk: 'getPayment' }), { fileGroup: 'payments' }),
                resolvedOp('/payments', op('post', { sdk: 'createPayment' }), { fileGroup: 'payments' }),
                resolvedOp('/payments', op('get', { sdk: 'listPayments' }), { fileGroup: 'payments' }),
            ],
            models: [],
            warnings: [],
        };
        const html = renderItemPage(unordered, { kind: 'overview' });
        const paymentsArea = html.split('<details class="ce-overview-area"')[1] ?? '';
        const order = [...paymentsArea.matchAll(/ce-method-(get|post|patch)[\s\S]*?<code class="ce-overview-endpoint-path">([^<]+)</g)]
            .map(m => `${m[1]!.toUpperCase()} ${m[2]!}`);
        expect(order).toEqual([
            'GET /payments',
            'POST /payments',
            'GET /payments/{id}',
            'PATCH /payments/{id}',
        ]);
    });

    it('starts areas collapsed when there are more than three', () => {
        const many: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: ['a', 'b', 'c', 'd'].map((g, i) =>
                resolvedOp(`/r${i}`, op('get', { sdk: `op${i}` }), { fileGroup: g }),
            ),
            models: [],
            warnings: [],
        };
        const html = renderItemPage(many, { kind: 'overview' });
        expect(html).not.toContain('<details class="ce-overview-area" open>');
        expect(html).toContain('<details class="ce-overview-area">');
    });

    it('omits the endpoints section when there are no operations', () => {
        const empty: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: [],
            models: [],
            warnings: [],
        };
        const html = renderItemPage(empty, { kind: 'overview' });
        expect(html).not.toContain('ce-overview-area');
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

    it('wraps each operation in a collapsible <details> when a file has multiple operations', () => {
        const multi: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: [
                resolvedOp('/payments', op('get', { sdk: 'listPayments' }), { filePath: '/contracts/payments.ck' }),
                resolvedOp('/payments/{id}', op('get', { sdk: 'getPayment' }), { filePath: '/contracts/payments.ck' }),
            ],
            models: [],
            warnings: [],
        };
        const html = renderItemPage(multi, { kind: 'file', path: '/contracts/payments.ck' });
        // Two collapsible cards, both open by default
        const matches = html.match(/class="ce-card ce-op-card ce-op-card-collapsible"/g) ?? [];
        expect(matches.length).toBe(2);
        expect(html).toContain('<details');
        expect(html).toContain('open>');
        expect(html).toContain('<summary class="ce-card-header"');
        // The bare <section class="ce-card ce-op-card"> form is not used when collapsible
        expect(html).not.toMatch(/<section[^>]*class="ce-card ce-op-card"[^>]*>/);
    });

    it('keeps the flat (non-collapsible) shape when a file has a single operation', () => {
        const single: PreviewData = {
            configMeta: { title: 'Test API', version: '1.0.0' },
            operations: [
                resolvedOp('/payments', op('get', { sdk: 'listPayments' }), { filePath: '/contracts/payments.ck' }),
            ],
            models: [],
            warnings: [],
        };
        const html = renderItemPage(single, { kind: 'file', path: '/contracts/payments.ck' });
        expect(html).not.toContain('ce-op-card-collapsible');
        expect(html).not.toContain('<summary class="ce-card-header"');
        expect(html).toMatch(/<section[^>]*class="ce-card ce-op-card"/);
    });
});
