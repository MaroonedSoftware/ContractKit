import { describe, expect, it } from 'vitest';
import { buildModelIndex } from '@contractkit/core';
import {
    buildPathCall,
    deriveClientClassName,
    deriveClientPropertyName,
    deriveMethodName,
    generateKotlinClient,
    hasPublicOperations,
} from '../src/codegen-client.js';
import { generateSdkKt } from '../src/codegen-sdk.js';
import { collectHoistedTypes } from '../src/hoist.js';
import { resolveModelsWithInput } from '../src/codegen-models.js';
import {
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
    refType,
    scalarType,
} from './helpers.js';

const PKG = 'com.acme.sdk';

const MODELS = [
    model('Payment', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('amount', scalarType('decimal'))]),
    model('PaymentRef', [field('paymentId', scalarType('uuid'))]),
    model('Form', [field('note', scalarType('string'), { optional: true })]),
];

function client(routes: Parameters<typeof opRoot>[0], opts: { includeInternal?: boolean } = {}): string {
    const root = opRoot(routes, 'contracts/billing.ck');
    const contract = contractRoot(MODELS, 'contracts/billing.ck');
    const modelIndex = buildModelIndex(MODELS);
    const modelsWithInput = resolveModelsWithInput(MODELS);
    const hoisted = collectHoistedTypes([contract], { modelIndex, modelsWithInput });
    return generateKotlinClient(root, { packageName: PKG, modelsWithInput, modelIndex, hoisted, ...opts });
}

describe('deriveMethodName', () => {
    it('prefers an explicit sdk name, then the operation name, then the verb and path', () => {
        const route = opRoute('/payments/{id}', []);
        expect(deriveMethodName(opOperation('get', { sdk: 'getPayment', name: 'Fetch One' }), route)).toBe('getPayment');
        expect(deriveMethodName(opOperation('get', { name: 'Create an Offer' }), route)).toBe('createAnOffer');
        expect(deriveMethodName(opOperation('get'), route)).toBe('getPaymentsById');
    });

    it('backticks a name that lands on a Kotlin keyword', () => {
        expect(deriveMethodName(opOperation('get', { sdk: 'object' }), opRoute('/x', []))).toBe('`object`');
    });

    it('rejects two operations that would generate the same method, which cannot both compile', () => {
        expect(() => client([opRoute('/a', [opOperation('get', { sdk: 'fetch' })]), opRoute('/b', [opOperation('get', { sdk: 'fetch' })])])).toThrow(
            /both generate the client method 'fetch'/,
        );
    });
});

describe('buildPathCall', () => {
    it('keeps literal segments as literals and passes dynamic ones through segment()', () => {
        expect(buildPathCall('/payments')).toBe('path("payments")');
        expect(buildPathCall('/payments/{paymentId}/receipt', paramNodes([opParam('paymentId', scalarType('uuid'))]))).toBe(
            'path("payments", segment(paymentId), "receipt")',
        );
    });

    it('camelCases a hyphenated placeholder, which is legal in the contract but not in Kotlin', () => {
        expect(buildPathCall('/invoices/{invoice-id}', paramNodes([opParam('invoice-id', scalarType('uuid'))]))).toBe(
            'path("invoices", segment(invoiceId))',
        );
    });

    it('reads through the params argument when the route declares its params as a model', () => {
        expect(buildPathCall('/refunds/{paymentId}', paramRef('PaymentRef'))).toBe('path("refunds", segment(params.paymentId))');
    });
});

describe('client naming', () => {
    it('names the class and property from the source file', () => {
        expect(deriveClientClassName('contracts/billing.ck')).toBe('BillingClient');
        expect(deriveClientPropertyName('contracts/ledger.categories.ck')).toBe('ledgerCategories');
    });
});

describe('hasPublicOperations', () => {
    const internalRoot = opRoot([opRoute('/x', [opOperation('get')], undefined, ['internal'])], 'a.ck');

    it('ignores internal operations unless asked for them', () => {
        expect(hasPublicOperations(internalRoot)).toBe(false);
        expect(hasPublicOperations(internalRoot, true)).toBe(true);
    });
});

describe('generateKotlinClient', () => {
    it('emits a suspend method per operation on a client taking the shared SdkHttp', () => {
        const out = client([opRoute('/payments', [opOperation('get', { sdk: 'listPayments', responses: [opResponse(200, 'array(Payment)')] })])]);
        expect(out).toContain('class BillingClient(private val http: SdkHttp) {');
        expect(out).toContain('suspend fun listPayments(): List<Payment> {');
        expect(out).toContain('val response = http.execute(HttpMethod.Get) {');
        expect(out).toContain('return http.decodeJson(response)');
    });

    it('takes the Input variant of a body and returns the read variant', () => {
        const out = client([
            opRoute('/payments', [
                opOperation('post', { sdk: 'createPayment', request: opRequest('Payment'), responses: [opResponse(200, 'Payment')] }),
            ]),
        ]);
        expect(out).toContain('suspend fun createPayment(body: PaymentInput): Payment {');
        expect(out).toContain('jsonBody(body, "application/json")');
    });

    it('returns Unit and omits the response binding for a bodiless status', () => {
        const out = client([opRoute('/payments', [opOperation('delete', { sdk: 'deletePayment', responses: [opResponse(204)] })])]);
        expect(out).toContain('suspend fun deletePayment() {');
        expect(out).toContain('    http.execute(HttpMethod.Delete) {');
        expect(out).not.toContain('val response = http.execute(HttpMethod.Delete)');
    });

    it('picks the body call from the declared content type', () => {
        const cases: [string, string, string][] = [
            ['application/x-www-form-urlencoded', 'formBody(body)', 'body: Form'],
            ['multipart/form-data', 'multipartBody(body)', 'body: List<PartData>'],
            ['text/plain', 'textBody(body, "text/plain")', 'body: String'],
            ['application/octet-stream', 'binaryBody(body, "application/octet-stream")', 'body: ByteArray'],
            ['application/vnd.api+json', 'jsonBody(body, "application/vnd.api+json")', 'body: Form'],
        ];
        for (const [mime, call, param] of cases) {
            const out = client([
                opRoute('/x', [opOperation('post', { sdk: 'send', request: opRequest('Form', mime), responses: [opResponse(204)] })]),
            ]);
            expect(out).toContain(call);
            expect(out).toContain(param);
        }
    });

    it('emits a request data class for an inline query block and passes it through params()', () => {
        const out = client([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'listPayments',
                    query: paramNodes([opParam('limit', scalarType('int'), { optional: true }), opParam('cursor', scalarType('string'))]),
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        expect(out).toContain('data class ListPaymentsQuery(');
        expect(out).toContain('    val limit: Long? = null,');
        expect(out).toContain('    val cursor: String,');
        expect(out).toContain('params(query)');
    });

    it('serialises a header under its wire name and passes it through headers()', () => {
        const out = client([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'listPayments',
                    headers: paramNodes([opParam('x-tenant', scalarType('string'))]),
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        expect(out).toContain('@SerialName("x-tenant") val xTenant: String,');
        expect(out).toContain('headers(customHeaders)');
    });

    it('makes the whole argument optional only when every field of the block is', () => {
        const allOptional = client([
            opRoute('/a', [
                opOperation('get', {
                    sdk: 'a',
                    query: paramNodes([opParam('q', scalarType('string'), { optional: true })]),
                    responses: [opResponse(204)],
                }),
            ]),
        ]);
        expect(allOptional).toContain('suspend fun a(query: AQuery? = null)');

        const oneRequired = client([
            opRoute('/b', [opOperation('get', { sdk: 'b', query: paramNodes([opParam('q', scalarType('string'))]), responses: [opResponse(204)] })]),
        ]);
        expect(oneRequired).toContain('suspend fun b(query: BQuery)');
    });

    it('passes a status the contract gives meaning to as an expected one rather than throwing', () => {
        const out = client([
            opRoute('/payments', [
                opOperation('get', {
                    sdk: 'listPayments',
                    responses: [opResponse(200, 'array(Payment)'), { statusCode: 304, bodies: [], hasBlock: true }],
                }),
            ]),
        ]);
        expect(out).toContain('expectStatuses = setOf(304)');
    });

    it('documents the statuses that raise, which the contract marks as errors', () => {
        const out = client([
            opRoute(
                '/payments/{paymentId}',
                [opOperation('get', { sdk: 'getPayment', responses: [opResponse(200, 'Payment'), opResponse(404)] })],
                paramNodes([opParam('paymentId', scalarType('uuid'))]),
            ),
        ]);
        expect(out).toContain('/** @throws SdkError on 404 */');
        expect(out).not.toContain('expectStatuses');
    });

    it('marks a deprecated operation and skips an internal one', () => {
        const out = client([
            opRoute('/a', [opOperation('get', { sdk: 'a', responses: [opResponse(204)] })], undefined, ['deprecated']),
            opRoute('/b', [opOperation('get', { sdk: 'b', responses: [opResponse(204)] })], undefined, ['internal']),
        ]);
        expect(out).toContain('@Deprecated("Deprecated in the contract")');
        expect(out).toContain('suspend fun a(');
        expect(out).not.toContain('suspend fun b(');
    });

    it('includes internal operations when asked', () => {
        const out = client([opRoute('/b', [opOperation('get', { sdk: 'b', responses: [opResponse(204)] })], undefined, ['internal'])], {
            includeInternal: true,
        });
        expect(out).toContain('suspend fun b(');
    });

    it('imports each model it names rather than star-importing the models package', () => {
        const out = client([opRoute('/payments', [opOperation('get', { sdk: 'listPayments', responses: [opResponse(200, 'array(Payment)')] })])]);
        expect(out).toContain('import com.acme.sdk.models.Payment');
        expect(out).not.toContain('import com.acme.sdk.models.*');
    });
});

describe('generateSdkKt', () => {
    it('gives every client the one shared SdkHttp', () => {
        const out = generateSdkKt(PKG, 'AcmeSdk', [
            { className: 'BillingClient', propertyName: 'billing' },
            { className: 'LedgerClient', propertyName: 'ledger' },
        ]);
        expect(out).toContain('class AcmeSdk(config: SdkConfig) : AutoCloseable {');
        expect(out).toContain('val http: SdkHttp = SdkHttp(config)');
        expect(out).toContain('val billing: BillingClient = BillingClient(http)');
        expect(out).toContain('val ledger: LedgerClient = LedgerClient(http)');
        expect(out).toContain('        http.close()');
    });

    it('still compiles as an entry point when the project declares no operations', () => {
        const out = generateSdkKt(PKG, 'Sdk', []);
        expect(out).toContain('class Sdk(config: SdkConfig) : AutoCloseable {');
    });
});
