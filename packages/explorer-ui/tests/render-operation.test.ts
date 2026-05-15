import { describe, expect, it } from 'vitest';
import { operationAnchor, renderOperation } from '../src/render-operation.js';
import { op, param, ref, resolvedOp, scalar } from './helpers.js';

describe('renderOperation', () => {
    it('renders the basic header with method, path, and jump button', () => {
        const html = renderOperation(
            resolvedOp('/payments/{id}', op('get', { service: 'PaymentsService.getById', name: 'Get Payment' })),
        );
        expect(html).toContain('class="ce-method ce-method-get"');
        expect(html).toContain('GET');
        expect(html).toContain('<code class="ce-path">/payments/{id}</code>');
        expect(html).toContain('data-jump-file="/test.ck"');
        expect(html).toContain('PaymentsService.getById');
        expect(html).toContain('<h1 class="ce-op-title">Get Payment</h1>');
        expect(html).toContain('class="ce-endpoint-row"');
        // Resize handle sits between the main column and the rail.
        expect(html).toContain('class="ce-op-resize"');
        expect(html).toContain('data-resize-handle');
        expect(html).toContain('role="separator"');
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
        expect(html).toContain('Path Parameters');
        expect(html).toContain('Query Parameters');
        expect(html).toContain('Request Headers');
        // Section headers now render as the new H3 with bottom border (sentence case, not uppercase).
        expect(html).toContain('<h3>Path Parameters</h3>');
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
        expect(html).toContain('<h3>Request</h3>');
        expect(html).toContain('<span class="ce-body-title">Body</span>');
        expect(html).toContain('application/json');
        expect(html).toContain('href="#model-PaymentInput"');
        expect(html).toContain('Responses');
        expect(html).toContain('ce-status-2xx');
        expect(html).toContain('ce-status-4xx');
        expect(html).toContain('href="#model-Payment"');
        expect(html).toContain('No response body.');
        // Inline status summary pills appear before the per-status blocks.
        expect(html).toContain('class="ce-status-summary"');
        // Summary pills are anchor links to the response blocks below.
        expect(html).toMatch(/ce-status-summary[^"]*"[^<]*<a class="ce-status ce-status-2xx" href="#response-200">200<\/a>/);
        // Response blocks have anchor ids matching the summary hrefs.
        expect(html).toContain('id="response-200"');
        expect(html).toContain('id="response-404"');
    });

    it('skips the status-summary row when there is only one response', () => {
        const html = renderOperation(
            resolvedOp('/payments', op('post', {
                responses: [{ statusCode: 201, contentType: 'application/json' }],
            })),
        );
        expect(html).not.toContain('class="ce-status-summary"');
        expect(html).toContain('id="response-201"');
    });

    it('renders effective modifiers as badges', () => {
        const html = renderOperation(
            resolvedOp('/x', op('get'), { effectiveModifiers: ['internal', 'deprecated'] }),
        );
        expect(html).toContain('ce-badge-internal');
        expect(html).toContain('ce-badge-deprecated');
    });

    it('renders security badges', () => {
        const securedHtml = renderOperation(resolvedOp('/x', op('get'), { effectiveSecurity: undefined }));
        expect(securedHtml).toContain('ce-badge-security-secured');

        const noneHtml = renderOperation(resolvedOp('/x', op('get'), { effectiveSecurity: 'none' }));
        expect(noneHtml).toContain('ce-badge-security-none');

        const policyHtml = renderOperation(
            resolvedOp('/x', op('get'), {
                effectiveSecurity: { policy: 'paymentsWrite', loc: { file: '/x.ck', line: 1 } },
            }),
        );
        expect(policyHtml).toContain('ce-badge-security-policy');
        expect(policyHtml).toContain('paymentsWrite');

        const noPolicyHtml = renderOperation(
            resolvedOp('/x', op('get'), {
                effectiveSecurity: { policy: false, loc: { file: '/x.ck', line: 1 } },
            }),
        );
        expect(noPolicyHtml).toContain('ce-badge-security-no-policy');
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
