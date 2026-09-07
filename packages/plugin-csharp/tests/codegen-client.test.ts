import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import type { ContractRootNode, OpRootNode } from '@contractkit/core';
import { buildPathExpression, deriveClientClassName, deriveMethodName, generateCSharpClient, hasPublicOperations } from '../src/codegen-client.js';
import { collectHoistedTypes } from '../src/hoist.js';
import { contractRoot, field, model, opOperation, opParam, opRequest, opResponse, opRoot, opRoute, paramRef, refType, scalarType } from './helpers.js';

function render(root: OpRootNode, opts: { contracts?: ContractRootNode[]; modelsWithInput?: Set<string>; includeInternal?: boolean } = {}): string {
    const contracts = opts.contracts ?? [];
    const modelIndex = buildModelIndex(contracts.flatMap(r => r.models));
    const modelsWithInput = opts.modelsWithInput ?? new Set<string>();
    const hoisted = collectHoistedTypes(contracts, { modelIndex, modelsWithInput });
    return generateCSharpClient(root, { namespace: 'Acme.Sdk', modelsWithInput, modelIndex, hoisted, includeInternal: opts.includeInternal });
}

describe('naming', () => {
    it('names the client after its file', () => {
        expect(deriveClientClassName('contracts/billing.op.ck')).toBe('BillingClient');
    });

    it('resolves the method name by sdk, then name, then verb and path', () => {
        const route = opRoute('/payments/{paymentId}', []);
        expect(deriveMethodName(opOperation('get', { sdk: 'fetchOne' }), route)).toBe('FetchOneAsync');
        expect(deriveMethodName(opOperation('get', { name: 'Create an Offer' }), route)).toBe('CreateAnOfferAsync');
        expect(deriveMethodName(opOperation('get'), route)).toBe('GetPaymentsByPaymentIdAsync');
    });

    it('rejects two operations that would generate the same method', () => {
        const root = opRoot([
            opRoute('/a', [opOperation('get', { sdk: 'thing' })]),
            opRoute('/b', [opOperation('post', { sdk: 'thing' })]),
        ]);
        expect(() => render(root)).toThrow(/both generate the client method 'ThingAsync'/);
    });
});

describe('path building', () => {
    it('keeps literal segments literal and escapes caller values', () => {
        expect(buildPathExpression('/payments/{paymentId}/receipt')).toBe('http.Path("payments", http.Segment(paymentId), "receipt")');
    });

    it('camelCases a hyphenated placeholder into a valid identifier', () => {
        expect(buildPathExpression('/invoices/{invoice-id}')).toBe('http.Path("invoices", http.Segment(invoiceId))');
    });

    it('reads a placeholder off the route model when the route declares one', () => {
        expect(buildPathExpression('/refunds/{paymentId}', paramRef('PaymentRef'))).toBe('http.Path("refunds", http.Segment(pathParams.PaymentId))');
    });
});

describe('class and method shape', () => {
    const contracts = [contractRoot([model('Payment', [field('id', scalarType('uuid'))])])];

    it('takes the shared SdkHttp through a primary constructor', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { sdk: 'list', responses: [opResponse(200, 'Payment')] })])], 'billing.ck');
        const out = render(root, { contracts });
        expect(out).toContain('public sealed class BillingClient(SdkHttp http)');
        expect(out).toContain('namespace Acme.Sdk.Clients;');
        expect(out).toContain('using Acme.Sdk.Models;');
    });

    it('returns the decoded body and always takes a trailing cancellation token', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { sdk: 'list', responses: [opResponse(200, 'array(Payment)')] })])]);
        const out = render(root, { contracts });
        expect(out).toContain('public async Task<List<Payment>> ListAsync(CancellationToken cancellationToken = default)');
        expect(out).toContain('return http.ReadJson<List<Payment>>(response);');
        expect(out).toContain('.ConfigureAwait(false);');
    });

    it('returns a plain Task and reads no body when the operation declares none', () => {
        const root = opRoot([opRoute('/payments/{id}', [opOperation('delete', { sdk: 'remove' })], [opParam('id', scalarType('uuid'))])]);
        const out = render(root, { contracts });
        expect(out).toContain('public async Task RemoveAsync(Guid id, CancellationToken cancellationToken = default)');
        expect(out).toContain('await http.ExecuteAsync(');
        expect(out).not.toContain('var response = await');
    });

    it('sends the Input variant of a body model', () => {
        const root = opRoot([opRoute('/payments', [opOperation('post', { sdk: 'create', request: opRequest('Payment') })])]);
        const out = render(root, { contracts, modelsWithInput: new Set(['Payment']) });
        expect(out).toContain('PaymentInput body');
        expect(out).toContain('content: http.JsonContent(body, "application/json")');
    });

    it('picks a content factory per body mime', () => {
        const kinds: [string, string, string][] = [
            ['multipart/form-data', 'IEnumerable<SdkPart> body', 'content: http.MultipartContent(body)'],
            ['application/x-www-form-urlencoded', 'Payment body', 'content: http.FormContent(body)'],
            ['text/plain', 'string body', 'content: http.TextContent(body, "text/plain")'],
            ['application/octet-stream', 'byte[] body', 'content: http.BinaryContent(body, "application/octet-stream")'],
        ];
        for (const [mime, param, call] of kinds) {
            const root = opRoot([opRoute('/x', [opOperation('post', { sdk: 'send', request: opRequest('Payment', mime) })])]);
            const out = render(root, { contracts });
            expect(out).toContain(param);
            expect(out).toContain(call);
        }
    });

    it('marks a deprecated operation obsolete', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { sdk: 'old' })], undefined, ['deprecated'])]);
        expect(render(root, { contracts })).toContain('[Obsolete("Deprecated in the contract")]');
    });

    it('skips internal operations unless asked for them', () => {
        const root = opRoot([
            opRoute('/pub', [opOperation('get', { sdk: 'pub' })]),
            opRoute('/priv', [opOperation('get', { sdk: 'priv' })], undefined, ['internal']),
        ]);
        expect(render(root, { contracts })).not.toContain('PrivAsync');
        expect(render(root, { contracts, includeInternal: true })).toContain('PrivAsync');
        expect(hasPublicOperations(opRoot([opRoute('/p', [opOperation('get')], undefined, ['internal'])]))).toBe(false);
    });
});

describe('parameters', () => {
    const contracts = [contractRoot([model('Payment', [field('id', scalarType('uuid'))])])];

    it('emits a query record whose keys are the declared names', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'list',
                    query: [opParam('cursor', scalarType('string')), opParam('limit', scalarType('int'), { optional: true })],
                }),
            ]),
        ]);
        const out = render(root, { contracts });
        expect(out).toContain('public sealed record ListQuery');
        expect(out).toContain('[JsonPropertyName("cursor")]');
        expect(out).toContain('public required string Cursor { get; init; }');
        expect(out).toContain('public long? Limit { get; init; }');
        expect(out).toContain('query: http.Params(query)');
    });

    it('makes the whole argument optional when every field may be omitted', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { sdk: 'list', query: [opParam('limit', scalarType('int'), { optional: true })] })]),
        ]);
        expect(render(root, { contracts })).toContain('ListQuery? query = null');
    });

    it('falls back to a plain map when a block declares nothing', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { sdk: 'list', query: [] })])]);
        expect(render(root, { contracts })).toContain('IReadOnlyDictionary<string, string>? query = null');
    });

    it('puts every required parameter ahead of every optional one, which C# requires', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'list',
                    query: [opParam('limit', scalarType('int'), { optional: true })],
                    headers: [opParam('x-tenant', scalarType('string'))],
                }),
            ]),
        ]);
        const out = render(root, { contracts });
        const signature = out.slice(out.indexOf('public async Task ListAsync('), out.indexOf('\n', out.indexOf('public async Task ListAsync(')));
        expect(signature.indexOf('customHeaders')).toBeLessThan(signature.indexOf('query'));
        expect(signature).toContain('ListQuery? query = null');
    });

    it('names a route-level params model pathParams, since params is a C# keyword', () => {
        const root = opRoot([opRoute('/refunds/{paymentId}', [opOperation('get', { sdk: 'refund' })], paramRef('PaymentRef'))]);
        const out = render(root, { contracts: [contractRoot([model('PaymentRef', [field('paymentId', scalarType('uuid'))])])] });
        expect(out).toContain('PaymentRef pathParams');
        expect(out).not.toContain('@params');
    });
});

describe('responses', () => {
    const contracts = [contractRoot([model('Payment', [field('id', scalarType('uuid'))])])];

    it('passes a declared error status as expected rather than letting it throw', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { sdk: 'list', responses: [opResponse(200, 'Payment'), opResponse(404, 'Payment')] })]),
        ]);
        expect(render(root, { contracts })).toContain('expectStatuses: new[] { 404 }');
    });

    it('documents the statuses that do throw', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { sdk: 'list', responses: [opResponse(200, 'Payment'), { statusCode: 500, bodies: [] }] })])]);
        expect(render(root, { contracts })).toContain('/// <exception cref="SdkException">On 500.</exception>');
    });

    it('switches on the status when the operation declares several', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { sdk: 'get', responses: [opResponse(200, 'Payment'), { statusCode: 304, bodies: [], hasBlock: true }] })]),
        ]);
        const out = render(root, { contracts });
        expect(out).toContain('switch (response.Status)');
        expect(out).toContain('public abstract record GetResponse');
        expect(out).toContain('    private GetResponse() { }');
        expect(out).toContain('public sealed record Status200(Payment Data) : GetResponse;');
        expect(out).toContain('public sealed record Status304() : GetResponse;');
        expect(out).toContain('case 304:');
    });

    it('switches on the content type when one status declares several mimes', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'get',
                    responses: [{ statusCode: 200, hasBlock: true, bodies: [{ contentType: 'application/json', bodyType: refType('Payment') }, { contentType: 'text/plain', bodyType: refType('Payment') }] }],
                }),
            ]),
        ]);
        const out = render(root, { contracts });
        expect(out).toContain('switch (response.ContentType)');
        expect(out).toContain('case "text/plain":');
        expect(out).toContain('public sealed record TextPlain(string Data) : GetResponse;');
        expect(out).toContain('public sealed record ApplicationJson(Payment Data) : GetResponse;');
    });
});

describe('response headers', () => {
    const contracts = [contractRoot([model('Payment', [field('id', scalarType('uuid'))])])];

    function withHeaders(headers: { name: string; optional: boolean; type: ReturnType<typeof scalarType> }[]): string {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { sdk: 'get', responses: [{ ...opResponse(200, 'Payment'), headers }] })]),
        ]);
        return render(root, { contracts });
    }

    it('requires a declared header and parses it to its type', () => {
        const out = withHeaders([
            { name: 'x-request-id', optional: false, type: scalarType('string') },
            { name: 'x-count', optional: false, type: scalarType('int') },
        ]);
        expect(out).toContain('http.RequireHeader(response, "x-request-id")');
        expect(out).toContain('long.Parse(http.RequireHeader(response, "x-count"), CultureInfo.InvariantCulture)');
        expect(out).toContain('public sealed record GetHeaders(string XRequestId, long XCount);');
        expect(out).toContain('public sealed record GetResult(Payment Data, GetHeaders Headers);');
    });

    it('leaves an optional header absent rather than failing', () => {
        const out = withHeaders([{ name: 'x-cache-hit', optional: true, type: scalarType('boolean') }]);
        expect(out).toContain('response.Header("x-cache-hit") is { } xCacheHit ? xCacheHit == "true" : null');
        expect(out).toContain('public sealed record GetHeaders(bool? XCacheHit);');
    });

    it('parses each header scalar the way the other SDKs do', () => {
        expect(withHeaders([{ name: 'h', optional: false, type: scalarType('uuid') }])).toContain('Guid.Parse(');
        expect(withHeaders([{ name: 'h', optional: false, type: scalarType('datetime') }])).toContain('DateTimeOffset.Parse(');
        expect(withHeaders([{ name: 'h', optional: false, type: scalarType('duration') }])).toContain('XmlConvert.ToTimeSpan(');
        expect(withHeaders([{ name: 'h', optional: false, type: scalarType('bigint') }])).toContain('BigInteger.Parse(');
    });

    it('rejects a header type that cannot come off the wire as text', () => {
        expect(() => withHeaders([{ name: 'h', optional: false, type: scalarType('json') }])).toThrow(/cannot be read from an HTTP header/);
    });
});
