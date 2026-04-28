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

    it('uses op.name as method name when op.sdk is not set', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', { name: 'Create a Payment', responses: [opResponse(201, 'Payment')] }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def create_a_payment(self)');
    });

    it('prefers op.sdk over op.name as method name', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', { sdk: 'makePayment', name: 'Create a Payment', responses: [opResponse(201, 'Payment')] }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def make_payment(self)');
        expect(output).not.toContain('create_a_payment');
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

    it('forwards a vendor JSON content_type kwarg to _fetch', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'createUser',
                    request: opRequest('User', 'application/vnd.api+json'),
                    responses: [opResponse(201, 'User', 'application/vnd.api+json')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('content_type="application/vnd.api+json"');
    });

    it('omits internal operations by default and includes them when includeInternal is true', () => {
        const root = opRoot([
            opRoute('/public', [opOperation('get', { sdk: 'getPublic', responses: [opResponse(200, 'User')] })]),
            opRoute('/secret', [opOperation('get', { sdk: 'getSecret', responses: [opResponse(200, 'User')] })], undefined, ['internal']),
        ]);
        const defaultOut = generatePythonClient(root);
        expect(defaultOut).toContain('async def get_public(');
        expect(defaultOut).not.toContain('async def get_secret(');

        const inclusiveOut = generatePythonClient(root, { includeInternal: true });
        expect(inclusiveOut).toContain('async def get_public(');
        expect(inclusiveOut).toContain('async def get_secret(');
    });

    it('typed body and response as str/bytes for text and binary content types', () => {
        const textRoot = opRoot([
            opRoute('/notes', [
                opOperation('post', {
                    sdk: 'putNote',
                    request: opRequest('Note', 'text/plain'),
                    responses: [opResponse(200, 'Note', 'text/plain')],
                }),
            ]),
        ]);
        const textOut = generatePythonClient(textRoot);
        expect(textOut).toContain('body: str');
        expect(textOut).toContain('-> str:');
        expect(textOut).toContain('body_kind="text"');
        expect(textOut).toContain('response_kind="text"');

        const binaryRoot = opRoot([
            opRoute('/files', [
                opOperation('get', {
                    sdk: 'downloadFile',
                    responses: [opResponse(200, 'File', 'application/octet-stream')],
                }),
            ]),
        ]);
        const binaryOut = generatePythonClient(binaryRoot);
        expect(binaryOut).toContain('-> bytes:');
        expect(binaryOut).toContain('response_kind="binary"');
    });

    it('omits content_type kwarg when the request is plain application/json', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'createUser',
                    request: opRequest('User'),
                    responses: [opResponse(201, 'User')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).not.toContain('content_type=');
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

    describe('response headers', () => {
        it('emits a TypedDict and tuple return type when response declares headers', () => {
            const root = opRoot([
                opRoute('/transfers/{id}', [
                    opOperation('get', {
                        sdk: 'getTransfer',
                        responses: [
                            {
                                statusCode: 200,
                                contentType: 'application/json',
                                bodyType: { kind: 'ref', name: 'Transfer' },
                                headers: [
                                    { name: 'preference-applied', optional: true, type: scalarType('string') },
                                    { name: 'etag', optional: false, type: scalarType('string') },
                                ],
                            },
                        ],
                    }),
                ], paramNodes([opParam('id', scalarType('uuid'))])),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('from typing import TypedDict');
            expect(output).toContain('class GetTransferHeaders(TypedDict, total=False):');
            expect(output).toContain('    preference_applied: str  # preference-applied (optional)');
            expect(output).toContain('    etag: str  # etag (required)');
            expect(output).toContain('-> tuple[Transfer, GetTransferHeaders]:');
            expect(output).toContain('await self._fetch_with_headers(');
            expect(output).toContain('"preference-applied" in _response_headers');
            expect(output).toContain('headers["preference_applied"] = _response_headers["preference-applied"]');
            expect(output).toContain('return Transfer.model_validate(result), headers');
        });

        it('returns just headers TypedDict for void ops with declared response headers', () => {
            const root = opRoot([
                opRoute('/resources/{id}', [
                    opOperation('delete', {
                        sdk: 'deleteResource',
                        responses: [
                            {
                                statusCode: 204,
                                headers: [{ name: 'x-deleted-at', optional: false, type: scalarType('string') }],
                            },
                        ],
                    }),
                ], paramNodes([opParam('id', scalarType('uuid'))])),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('class DeleteResourceHeaders(TypedDict, total=False):');
            expect(output).toContain('-> DeleteResourceHeaders:');
            expect(output).toContain('return headers');
        });

        it('keeps plain return type when no response headers are declared', () => {
            const root = opRoot([
                opRoute('/users/{id}', [opOperation('get', { sdk: 'getUser', responses: [opResponse(200, 'User')] })], paramNodes([opParam('id', scalarType('uuid'))])),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('-> User:');
            expect(output).not.toContain('TypedDict');
            expect(output).not.toContain('_fetch_with_headers');
        });
    });
});
