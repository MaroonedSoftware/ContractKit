import { describe, it, expect } from 'vitest';
import { generatePythonClient, deriveClientClassName, deriveClientModuleName, hasPublicOperations } from '../src/codegen-client.js';
import {
    scalarType, arrayType, refType, enumType,
    opParam, paramNodes, paramRef, paramType, opRequest, opResponse, opOperation, opRoute, opRoot,
} from './helpers.js';

// ─── deriveClientClassName ────────────────────────────────────────────────

describe('deriveClientClassName', () => {
    it('derives class name from file', () => {
        expect(deriveClientClassName('payments.op.ck')).toBe('PaymentsClient');
        expect(deriveClientClassName('ledger.categories.op.ck')).toBe('LedgerCategoriesClient');
        expect(deriveClientClassName('/path/to/users.op.ck')).toBe('UsersClient');
    });
});

describe('deriveClientModuleName', () => {
    it('derives module name from file', () => {
        expect(deriveClientModuleName('payments.op.ck')).toBe('_client_payments');
        expect(deriveClientModuleName('ledger.categories.op.ck')).toBe('_client_ledger_categories');
    });
});

// ─── hasPublicOperations ──────────────────────────────────────────────────

describe('hasPublicOperations', () => {
    it('returns false for all-internal ops', () => {
        const root = opRoot([
            opRoute('/internal', [opOperation('get')], undefined, ['internal']),
        ]);
        expect(hasPublicOperations(root)).toBe(false);
    });

    it('returns true when at least one public op exists', () => {
        const root = opRoot([
            opRoute('/public', [opOperation('get')]),
        ]);
        expect(hasPublicOperations(root)).toBe(true);
    });
});

// ─── generatePythonClient ─────────────────────────────────────────────────

describe('generatePythonClient', () => {
    it('generates a class with the right name', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ]),
        ], 'payments.op.ck');
        const output = generatePythonClient(root);
        expect(output).toContain('class PaymentsClient(BaseClient):');
    });

    it('skips internal operations', () => {
        const root = opRoot([
            opRoute('/internal', [opOperation('get', { responses: [opResponse(200, 'User')] })], undefined, ['internal']),
            opRoute('/public', [opOperation('get', { responses: [opResponse(200, 'User')] })]),
        ]);
        const output = generatePythonClient(root);
        const methodCount = (output.match(/async def /g) || []).length;
        expect(methodCount).toBe(1);
    });

    it('infers method names from path and method', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'array(Payment)')] })]),
            opRoute('/payments/{id}', [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('id', scalarType('uuid'))])),
            opRoute('/payments', [opOperation('post', { request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment')] })]),
        ], 'payments.op.ck');
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payments(self)');
        expect(output).toContain('async def get_payments_by_id(self, id: UUID)');
        expect(output).toContain('async def post_payments(self, body: PaymentInput)');
    });

    it('uses op.sdk name when provided (converted to snake_case)', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('get', { sdk: 'getPayment', responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payment(self, id: UUID)');
    });

    it('generates void return for operations with no body', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('delete', { responses: [opResponse(204)] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('-> None:');
        expect(output).toContain('return None');
    });

    it('generates model_validate for model responses', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('Payment.model_validate(result)');
    });

    it('generates list comprehension for array model responses', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', { responses: [opResponse(200, 'array(Payment)')] }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('[Payment.model_validate(item) for item in result]');
    });

    it('generates query parameter', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('query: dict | None = None');
        expect(output).toContain('params=query');
    });

    it('generates body parameter for POST', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', {
                    request: opRequest('PaymentInput'),
                    responses: [opResponse(201, 'Payment')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('body: PaymentInput');
        expect(output).toContain('body=body.model_dump(mode="json")');
    });

    it('generates path param interpolation in f-string', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('f"/payments/{id}"');
    });

    it('imports model types from their modules', () => {
        const modelModulePaths = new Map([['Payment', '._models_payment'], ['PaymentInput', '._models_payment']]);
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', {
                    request: opRequest('PaymentInput'),
                    responses: [opResponse(201, 'Payment')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root, { modelModulePaths });
        expect(output).toContain('from ._models_payment import Payment, PaymentInput');
    });

    it('imports UUID when uuid scalar is used', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('get', { responses: [opResponse(204)] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('from uuid import UUID');
    });

    it('adds deprecated comment for deprecated operations', () => {
        const root = opRoot([
            opRoute('/old', [
                opOperation('get', { responses: [opResponse(200, 'User')] }),
            ], undefined, ['deprecated']),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('# @deprecated');
    });

    it('uses model_dump for Input variant body when modelsWithInput is set', () => {
        const modelsWithInput = new Set(['Payment']);
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', {
                    request: opRequest('Payment'),
                    responses: [opResponse(201, 'Payment')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root, { modelsWithInput });
        expect(output).toContain('body: PaymentInput');
        expect(output).toContain('body=body.model_dump(mode="json")');
    });
});
