import { describe, expect, it } from 'vitest';
import { operationAnchor, renderOperation } from '../src/render-operation.js';
import { op, param, ref, resolvedOp, scalar } from './helpers.js';

describe('renderOperation', () => {
    it('renders the basic header with method, path, and jump button', () => {
        const html = renderOperation(
            resolvedOp('/payments/{id}', op('get', { service: 'PaymentsService.getById' })),
        );
        expect(html).toContain('class="ce-method ce-method-get"');
        expect(html).toContain('GET');
        expect(html).toContain('<code class="ce-path">/payments/{id}</code>');
        expect(html).toContain('data-jump-file="/test.ck"');
        expect(html).toContain('PaymentsService.getById');
    });

    it('renders an anchor id derived from method/path/sdk', () => {
        const r = resolvedOp('/payments/{id}', op('get', { sdk: 'getPayment' }));
        expect(renderOperation(r)).toContain(`id="${operationAnchor(r)}"`);
        expect(operationAnchor(r)).toMatch(/^op-get-payments-id-getpayment$/);
    });

    it('renders path/query/header param tables', () => {
        const html = renderOperation(
            resolvedOp(
                '/payments/{id}',
                op('get', {
                    query: { kind: 'params', nodes: [param('limit', scalar('int'), { optional: true })] },
                    headers: { kind: 'params', nodes: [param('X-Token', scalar('string'))] },
                }),
                {
                    routeParams: { kind: 'params', nodes: [param('id', scalar('uuid'))] },
                },
            ),
        );
        expect(html).toContain('Path params');
        expect(html).toContain('Query');
        expect(html).toContain('Headers');
        expect(html).toContain('<code>limit</code>');
        expect(html).toContain('<code>X-Token</code>');
        expect(html).toContain('<code>id</code>');
    });

    it('renders request body and responses', () => {
        const html = renderOperation(
            resolvedOp(
                '/payments',
                op('post', {
                    request: { bodies: [{ contentType: 'application/json', bodyType: ref('PaymentInput') }] },
                    responses: [
                        { statusCode: 200, contentType: 'application/json', bodyType: ref('Payment') },
                        { statusCode: 404 },
                    ],
                }),
            ),
        );
        expect(html).toContain('Request body');
        expect(html).toContain('application/json');
        expect(html).toContain('href="#model-PaymentInput"');
        expect(html).toContain('Responses');
        expect(html).toContain('ce-status-2xx');
        expect(html).toContain('ce-status-4xx');
        expect(html).toContain('href="#model-Payment"');
        expect(html).toContain('No body.');
    });

    it('renders effective modifiers as badges', () => {
        const html = renderOperation(
            resolvedOp('/x', op('get'), { effectiveModifiers: ['internal', 'deprecated'] }),
        );
        expect(html).toContain('ce-badge-internal');
        expect(html).toContain('ce-badge-deprecated');
    });

    it('renders security badges', () => {
        const noneHtml = renderOperation(resolvedOp('/x', op('get'), { effectiveSecurity: 'none' }));
        expect(noneHtml).toContain('ce-badge-security-none');

        const policyHtml = renderOperation(
            resolvedOp('/x', op('get'), {
                effectiveSecurity: { policy: 'paymentsWrite', loc: { file: '/x.ck', line: 1 } },
            }),
        );
        expect(policyHtml).toContain('ce-badge-security-policy');
        expect(policyHtml).toContain('paymentsWrite');
    });

    it('renders plugin extensions in a collapsible JSON block', () => {
        const html = renderOperation(
            resolvedOp('/x', op('get', { pluginExtensions: { bruno: { template: 'foo.yml' } } })),
        );
        expect(html).toContain('Plugin extensions');
        expect(html).toContain('<details><summary>Show JSON</summary>');
        expect(html).toContain('bruno');
    });
});
