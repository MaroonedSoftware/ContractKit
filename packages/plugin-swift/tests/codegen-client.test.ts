import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import { collectHoistedTypes } from '../src/hoist.js';
import { resolveModelsWithInput } from '../src/codegen-models.js';
import {
    buildPathSegments,
    deriveClientClassName,
    deriveClientPropertyName,
    deriveMethodName,
    generateSwiftClient,
    hasPublicOperations,
} from '../src/codegen-client.js';
import { generateSdkSwift } from '../src/codegen-sdk.js';
import {
    arrayType,
    contractRoot,
    field,
    model,
    opOperation,
    opParam,
    opRequest,
    opResponse,
    opRoot,
    opRoute,
    paramNodes,
    paramRef,
    scalarType,
} from './helpers.js';
import type { ModelNode, OpRootNode } from './helpers.js';

const MODELS: ModelNode[] = [model('Payment', [field('id', scalarType('uuid'))]), model('PaymentRef', [field('paymentId', scalarType('uuid'))])];

function gen(root: OpRootNode, models: ModelNode[] = MODELS, opts: { includeInternal?: boolean; modelsWithInput?: Set<string> } = {}): string {
    const modelIndex = buildModelIndex(models);
    const modelsWithInput = resolveModelsWithInput(models, opts.modelsWithInput);
    const hoisted = collectHoistedTypes([contractRoot(models)], { modelIndex, modelsWithInput });
    return generateSwiftClient(root, { modelIndex, modelsWithInput, hoisted, includeInternal: opts.includeInternal });
}

// ─── Naming ────────────────────────────────────────────────────────────────

describe('naming', () => {
    it('names the class and property after the source file', () => {
        expect(deriveClientClassName('contracts/billing.op.ck')).toBe('BillingClient');
        expect(deriveClientPropertyName('contracts/billing.op.ck')).toBe('billing');
    });

    it('takes the method name from sdk:, then name:, then the verb and path', () => {
        const route = opRoute('/payments/{paymentId}', []);
        expect(deriveMethodName(opOperation('get', { sdk: 'getPayment', name: 'Fetch a payment' }), route)).toBe('getPayment');
        expect(deriveMethodName(opOperation('get', { name: 'Create an Offer' }), route)).toBe('createAnOffer');
        expect(deriveMethodName(opOperation('get'), route)).toBe('getPaymentsByPaymentId');
    });

    it('escapes a method name that lands on a reserved word', () => {
        expect(deriveMethodName(opOperation('get', { sdk: 'repeat' }), opRoute('/x', []))).toBe('`repeat`');
    });

    it('rejects two operations that would generate one method, rather than emitting a redeclaration', () => {
        const root = opRoot([opRoute('/a', [opOperation('get', { sdk: 'list' })]), opRoute('/b', [opOperation('get', { sdk: 'list' })])]);
        expect(() => gen(root)).toThrow(/both generate the client method 'list'/);
    });
});

describe('operation selection', () => {
    it('skips internal operations unless asked for them', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { sdk: 'hidden' })], undefined, ['internal'])]);
        expect(hasPublicOperations(root)).toBe(false);
        expect(hasPublicOperations(root, true)).toBe(true);
        expect(gen(root)).not.toContain('func hidden');
        expect(gen(root, MODELS, { includeInternal: true })).toContain('func hidden');
    });

    it('marks a deprecated operation, so a caller sees it at the call site', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', { sdk: 'old' })], undefined, ['deprecated'])]);
        expect(gen(root)).toContain('@available(*, deprecated, message: "Deprecated in the contract")');
    });
});

// ─── Class shape ───────────────────────────────────────────────────────────

describe('class shape', () => {
    // `opRoot` defaults to `payments.op.ck`, which is where the class name comes from.
    const out = gen(opRoot([opRoute('/payments', [opOperation('get', { sdk: 'listPayments', responses: [opResponse(200, 'Payment')] })])]));

    it('is a Sendable final class over the shared http helper', () => {
        expect(out).toContain('public final class PaymentsClient: Sendable {');
        expect(out).toContain('private let http: SdkHttp');
        expect(out).toContain('public init(http: SdkHttp) {');
    });

    it('emits an async throws method returning the declared body', () => {
        expect(out).toContain('public func listPayments() async throws -> Payment {');
        expect(out).toContain('let request = SdkRequest(method: "GET", path: ["payments"])');
        expect(out).toContain('let response = try await http.execute(request)');
        expect(out).toContain('return try http.decodeJSON(Payment.self, from: response)');
    });
});

describe('path building', () => {
    it('quotes literal segments and routes dynamic ones through the encoder', () => {
        const params = paramNodes([opParam('paymentId', scalarType('uuid'))]);
        expect(buildPathSegments('/payments/{paymentId}/receipt', params)).toEqual({
            segments: ['"payments"', 'http.segment(paymentId)', '"receipt"'],
            throws: true,
        });
    });

    it('camelCases a hyphenated placeholder, which the grammar allows', () => {
        expect(buildPathSegments('/x/{payment-id}').segments).toEqual(['"x"', 'http.segment(paymentId)']);
    });

    it('reads a params model through the one argument that carries it', () => {
        expect(buildPathSegments('/refunds/{paymentId}', paramRef('PaymentRef')).segments).toEqual(['"refunds"', 'http.segment(params.paymentId)']);
    });

    it('needs no try when every segment is a literal', () => {
        expect(buildPathSegments('/payments')).toEqual({ segments: ['"payments"'], throws: false });
    });

    it('spreads declared path params across the signature, or takes the model whole', () => {
        const spread = gen(
            opRoot([
                opRoute('/payments/{paymentId}', [opOperation('get', { sdk: 'getPayment' })], paramNodes([opParam('paymentId', scalarType('uuid'))])),
            ]),
        );
        expect(spread).toContain('public func getPayment(paymentId: UUID) async throws {');
        expect(spread).toContain('let request = try SdkRequest(method: "GET", path: ["payments", http.segment(paymentId)])');

        const byRef = gen(opRoot([opRoute('/refunds/{paymentId}', [opOperation('get', { sdk: 'getRefund' })], paramRef('PaymentRef'))]));
        expect(byRef).toContain('public func getRefund(params: PaymentRef) async throws {');
    });
});

// ─── Request shapes ────────────────────────────────────────────────────────

describe('request bodies', () => {
    const bodyFor = (contentType: string): string =>
        gen(opRoot([opRoute('/x', [opOperation('post', { sdk: 'send', request: opRequest('Payment', contentType) })])]));

    it('sends JSON through the encoder', () => {
        const out = bodyFor('application/json');
        expect(out).toContain('body: Payment');
        expect(out).toContain('try http.setJSONBody(&request, body, contentType: "application/json")');
    });

    it('sends a form body as encoded pairs', () => {
        expect(bodyFor('application/x-www-form-urlencoded')).toContain(
            'try http.setFormBody(&request, body, contentType: "application/x-www-form-urlencoded")',
        );
    });

    it('takes multipart as parts the caller assembles, not as the contract type', () => {
        const out = bodyFor('multipart/form-data');
        expect(out).toContain('body: [MultipartPart]');
        expect(out).toContain('http.setMultipartBody(&request, body)');
    });

    it('takes text and binary bodies as their Swift types', () => {
        expect(bodyFor('text/plain')).toContain('body: String');
        expect(bodyFor('application/octet-stream')).toContain('body: Data');
    });

    it('takes the Input twin of a split model, so a request never asks for a readonly field', () => {
        const models = [
            model('Cred', [
                field('id', scalarType('uuid'), { visibility: 'readonly' }),
                field('secret', scalarType('string'), { visibility: 'writeonly' }),
            ]),
        ];
        const out = gen(
            opRoot([
                opRoute('/creds', [opOperation('post', { sdk: 'createCred', request: opRequest('Cred'), responses: [opResponse(200, 'Cred')] })]),
            ]),
            models,
        );
        expect(out).toContain('body: CredInput');
        expect(out).toContain('return try http.decodeJSON(Cred.self, from: response)');
    });
});

describe('query and headers', () => {
    const root = opRoot([
        opRoute('/payments', [
            opOperation('get', {
                sdk: 'listPayments',
                query: [opParam('limit', scalarType('int'), { optional: true }), opParam('cursor', scalarType('string'))],
                headers: [opParam('api-key', scalarType('string'), { optional: true })],
                responses: [opResponse(200, 'Payment')],
            }),
        ]),
    ]);
    const out = gen(root);

    it('emits an Encodable struct per block, spelling the wire names out', () => {
        expect(out).toContain('public struct ListPaymentsQuery: Encodable, Equatable, Sendable {');
        expect(out).toContain('case limit = "limit"');
        expect(out).toContain('public struct ListPaymentsHeaders: Encodable, Equatable, Sendable {');
        expect(out).toContain('case apiKey = "api-key"');
    });

    it('makes the argument optional only when every field of the block is', () => {
        // `cursor` is required, so the whole query object has to be passed.
        expect(out).toContain('query: ListPaymentsQuery, customHeaders: ListPaymentsHeaders? = nil');
    });

    it('hands both to the runtime, which flattens them', () => {
        expect(out).toContain('try http.addQuery(&request, query)');
        expect(out).toContain('try http.addHeaders(&request, customHeaders)');
    });

    it('falls back to a dictionary for a block that declares nothing', () => {
        const empty = gen(opRoot([opRoute('/x', [opOperation('get', { sdk: 'x', query: [] })])]));
        expect(empty).toContain('query: [String: String]? = nil');
    });
});

// ─── Responses ─────────────────────────────────────────────────────────────

describe('response shapes', () => {
    it('returns Void for an operation with no observable body', () => {
        const out = gen(opRoot([opRoute('/x', [opOperation('delete', { sdk: 'remove', responses: [opResponse(400)] })])]));
        expect(out).toContain('public func remove() async throws {');
        expect(out).toContain('_ = try await http.execute(request)');
    });

    it('pairs the body with a typed struct when the contract declares response headers', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'get',
                        responses: [
                            {
                                ...opResponse(200, 'Payment'),
                                headers: [
                                    { name: 'x-request-id', optional: false, type: scalarType('string') },
                                    { name: 'x-cache-hit', optional: true, type: scalarType('boolean') },
                                ],
                            },
                        ],
                    }),
                ]),
            ]),
        );
        expect(out).toContain('async throws -> GetResult {');
        expect(out).toContain('public struct GetHeaders: Equatable, Sendable {');
        expect(out).toContain('public let xRequestId: String');
        expect(out).toContain('public let xCacheHit: Bool?');
        // A promised header the service omitted is a broken contract; an optional one is just absent.
        expect(out).toContain('xRequestId: http.requireHeader(response, "x-request-id", as: String.self)');
        expect(out).toContain('xCacheHit: http.optionalHeader(response, "x-cache-hit", as: Bool.self)');
        expect(out).toContain('return GetResult(data: try http.decodeJSON(Payment.self, from: response), headers: headers)');
    });

    it('rejects a header type that cannot be read from an HTTP header', () => {
        const root = opRoot([
            opRoute('/x', [
                opOperation('get', {
                    sdk: 'get',
                    responses: [
                        { ...opResponse(200, 'Payment'), headers: [{ name: 'x-thing', optional: false, type: arrayType(scalarType('string')) }] },
                    ],
                }),
            ]),
        ]);
        expect(() => gen(root)).toThrow(/cannot be read from an HTTP header/);
    });

    it('returns a flat enum over statuses, with the first declared one as the fall-through', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'getPayment',
                        responses: [opResponse(200, 'Payment'), { statusCode: 304, bodies: [], hasBlock: true }],
                    }),
                ]),
            ]),
        );
        expect(out).toContain('async throws -> GetPaymentResponse {');
        expect(out).toContain('public enum GetPaymentResponse: Equatable, Sendable {');
        expect(out).toContain('case status200(Payment)');
        expect(out).toContain('case status304');
        expect(out).toContain('switch response.status {');
        expect(out).toContain('case 304:');
        expect(out).toContain('default:');
        // A non-2xx status the contract gives meaning to is a value, so it must not raise.
        expect(out).toContain('try await http.execute(request, expectStatuses: [304])');
    });

    it('returns a case per content type when one status declares several', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'export',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [
                                    { contentType: 'application/json', bodyType: { kind: 'ref', name: 'Payment' } },
                                    { contentType: 'text/csv', bodyType: scalarType('string') },
                                ],
                            },
                        ],
                    }),
                ]),
            ]),
        );
        expect(out).toContain('case applicationJson(Payment)');
        expect(out).toContain('case textCsv(String)');
        expect(out).toContain('switch response.contentType {');
        expect(out).toContain('case "text/csv":');
        expect(out).toContain('return .textCsv(response.text)');
    });

    it('reads the response headers before the content-type dispatch that hands them to every case', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'export',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [
                                    { contentType: 'application/json', bodyType: { kind: 'ref', name: 'Payment' } },
                                    { contentType: 'text/csv', bodyType: scalarType('string') },
                                ],
                                headers: [{ name: 'x-request-id', optional: false, type: scalarType('string') }],
                            },
                        ],
                    }),
                ]),
            ]),
        );
        expect(out).toContain('public struct ExportHeaders: Equatable, Sendable {');
        expect(out).toContain(
            [
                '        let headers = try ExportHeaders(',
                '            xRequestId: http.requireHeader(response, "x-request-id", as: String.self)',
                '        )',
                '        switch response.contentType {',
                '        case "text/csv":',
                '            return .textCsv(data: response.text, headers: headers)',
                '        default:',
                '            return .applicationJson(data: try http.decodeJSON(Payment.self, from: response), headers: headers)',
                '        }',
            ].join('\n'),
        );
    });

    it('documents the statuses that raise instead of returning', () => {
        const out = gen(
            opRoot([opRoute('/x', [opOperation('get', { sdk: 'get', name: 'Fetch it', responses: [opResponse(200, 'Payment'), opResponse(404)] })])]),
        );
        expect(out).toContain('/// Fetch it');
        expect(out).toContain('/// - Throws: `SdkError` on 404');
    });
});

// ─── Aggregator ────────────────────────────────────────────────────────────

describe('generateSdkSwift', () => {
    const out = generateSdkSwift('AcmeSdk', [{ className: 'BillingClient', propertyName: 'billing' }]);

    it('shares one http helper across every client', () => {
        expect(out).toContain('public final class AcmeSdk: Sendable {');
        expect(out).toContain('let http = SdkHttp(config: config)');
        expect(out).toContain('self.billing = BillingClient(http: http)');
        expect(out).toContain('public let billing: BillingClient');
    });

    it('offers a base-URL initializer, so the common case needs no config value', () => {
        expect(out).toContain('public convenience init(baseURL: URL, headers: @escaping @Sendable () async throws -> [String: String] = { [:] }) {');
    });
});

// ─── Names that would not bind ─────────────────────────────────────────────

describe('path params that would not bind', () => {
    it('backticks a path param named after a Swift reserved word, in the signature and the path alike', () => {
        const out = gen(opRoot([opRoute('/seats/{class}', [opOperation('get', { sdk: 'getSeat' })], [opParam('class', scalarType('string'))])]));
        expect(out).toContain('public func getSeat(`class`: String) async throws {');
        expect(out).toContain('path: ["seats", http.segment(`class`)]');
    });

    it('suffixes a path param named like the request body argument, which would repeat a label', () => {
        const out = gen(
            opRoot([
                opRoute(
                    '/notes/{body}',
                    [opOperation('put', { sdk: 'putNote', request: opRequest('Payment') })],
                    [opParam('body', scalarType('string'))],
                ),
            ]),
        );
        expect(out).toContain('public func putNote(body_: String, body: Payment) async throws {');
        expect(out).toContain('http.segment(body_)');
        expect(out).toContain('try http.setJSONBody(&request, body, contentType: "application/json")');
    });

    it.each(['query', 'customHeaders', 'request', 'response', 'headers', 'http', 'params'])(
        'suffixes a path param named `%s`, which the method already binds or reads',
        name => {
            const out = gen(opRoot([opRoute(`/things/{${name}}`, [opOperation('get', { sdk: 'getThing' })], [opParam(name, scalarType('string'))])]));
            expect(out).toContain(`public func getThing(${name}_: String) async throws {`);
            expect(out).toContain(`http.segment(${name}_)`);
        },
    );
});

describe('request and response headers on one operation', () => {
    const requestHeaders = [opParam('from', scalarType('string'), { optional: true })];
    const responseHeaders = [{ name: 'x-request-id', optional: false, type: scalarType('string') }];

    it('gives the response side its own struct name, so the module does not declare GetHeaders twice', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'get',
                        headers: requestHeaders,
                        responses: [{ ...opResponse(200, 'Payment'), headers: responseHeaders }],
                    }),
                ]),
            ]),
        );
        expect(out.match(/public struct GetHeaders:/g)).toHaveLength(1);
        expect(out).toContain('customHeaders: GetHeaders? = nil');
        expect(out).toContain('public struct GetResponseHeaders: Equatable, Sendable {');
        expect(out).toContain('public let headers: GetResponseHeaders');
        expect(out).toContain('let headers = try GetResponseHeaders(');
    });

    it('returns the renamed struct when the status carries headers and no body', () => {
        const out = gen(
            opRoot([
                opRoute('/x', [
                    opOperation('get', {
                        sdk: 'get',
                        headers: requestHeaders,
                        responses: [{ statusCode: 204, bodies: [], headers: responseHeaders }],
                    }),
                ]),
            ]),
        );
        expect(out).toContain('async throws -> GetResponseHeaders {');
    });

    it('keeps GetHeaders for the response side when the operation declares no request headers', () => {
        const out = gen(
            opRoot([opRoute('/x', [opOperation('get', { sdk: 'get', responses: [{ ...opResponse(200, 'Payment'), headers: responseHeaders }] })])]),
        );
        expect(out).toContain('public struct GetHeaders: Equatable, Sendable {');
        expect(out).not.toContain('GetResponseHeaders');
    });
});
