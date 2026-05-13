import { describe, expect, it } from 'vitest';
import { renderApp } from '../src/render.js';
import type { PreviewData } from '../src/types.js';
import { field, model, op, ref, resolvedModel, resolvedOp, scalar } from './helpers.js';

describe('renderApp', () => {
    const data: PreviewData = {
        configMeta: { title: 'My API', version: '1.0.0', description: 'A test API.' },
        operations: [
            resolvedOp('/payments', op('get', { sdk: 'listPayments' }), { fileGroup: 'payments' }),
            resolvedOp(
                '/payments/{id}',
                op('get', { sdk: 'getPayment', responses: [{ statusCode: 200, bodyType: ref('Payment') }] }),
                { fileGroup: 'payments' },
            ),
            resolvedOp('/users', op('post', { sdk: 'createUser' }), { fileGroup: 'users' }),
        ],
        models: [
            resolvedModel(model('Payment', [field('id', scalar('uuid')), field('amount', scalar('number'))])),
            resolvedModel(model('User', [field('email', scalar('email'))])),
        ],
        warnings: [],
    };

    it('renders sidebar with grouped endpoints and model list', () => {
        const html = renderApp(data);
        expect(html).toContain('class="ce-sidebar"');
        expect(html).toContain('<summary>payments</summary>');
        expect(html).toContain('<summary>users</summary>');
        expect(html).toContain('href="#model-Payment"');
        expect(html).toContain('href="#model-User"');
    });

    it('renders the overview section', () => {
        const html = renderApp(data);
        expect(html).toContain('id="overview"');
        expect(html).toContain('My API');
        expect(html).toContain('v1.0.0');
        expect(html).toContain('A test API.');
    });

    it('renders endpoint and model sections', () => {
        const html = renderApp(data);
        expect(html).toContain('id="endpoints"');
        expect(html).toContain('id="models"');
    });

    it('renders a warnings banner when warnings are present', () => {
        const html = renderApp({ ...data, warnings: [{ message: 'thing broke', file: '/x.ck', line: 12 }] });
        expect(html).toContain('class="ce-warnings"');
        expect(html).toContain('thing broke');
        expect(html).toContain('/x.ck');
        expect(html).toContain(':12');
    });

    it('omits sections when arrays are empty', () => {
        const empty: PreviewData = {
            configMeta: { title: 'Empty', version: '0.0.0' },
            operations: [],
            models: [],
            warnings: [],
        };
        const html = renderApp(empty);
        expect(html).not.toContain('id="endpoints"');
        expect(html).not.toContain('id="models"');
        expect(html).toContain('id="overview"');
    });

    it('renders servers when configured', () => {
        const withServers: PreviewData = {
            ...data,
            configMeta: {
                ...data.configMeta,
                servers: [{ url: 'https://api.example.com', description: 'prod' }],
            },
        };
        const html = renderApp(withServers);
        expect(html).toContain('Servers');
        expect(html).toContain('https://api.example.com');
        expect(html).toContain('prod');
    });
});
