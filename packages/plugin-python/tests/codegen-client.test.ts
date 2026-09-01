import { describe, it, expect } from 'vitest';
import { generatePythonClient, deriveClientClassName, deriveClientModuleName, hasPublicOperations, BASE_CLIENT_PY } from '../src/codegen-client.js';
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

    it('sends a urlencoded body as form data, not JSON', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', {
                    request: opRequest('PaymentForm', 'application/x-www-form-urlencoded'),
                    responses: [opResponse(200, 'Payment')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // Without body_kind this fell through to the "json" default, so httpx sent a JSON
        // document under a form Content-Type.
        expect(output).toContain('body_kind="form"');
        expect(output).toContain('content_type="application/x-www-form-urlencoded"');
    });

    it('sends a multipart body through files= and lets httpx own the Content-Type', () => {
        const root = opRoot([
            opRoute('/receipts', [
                opOperation('post', {
                    request: opRequest('ReceiptForm', 'multipart/form-data'),
                    responses: [opResponse(200, 'Payment')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('body_kind="multipart"');
        // A mapping of parts, not bytes: httpx generates the boundary from it, and a caller
        // could never have supplied a boundary of their own.
        expect(output).toContain('body: dict');
    });

    it('leaves a JSON body on the json= path with no body_kind', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('post', { request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment')] }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).not.toContain('body_kind=');
    });

    it('generates path param interpolation in f-string', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('f"/payments/{quote(str(id), safe=\'\')}"');
        expect(output).toContain('from urllib.parse import quote');
    });

    it('interpolates the snake_cased name the signature actually binds', () => {
        const root = opRoot([
            opRoute('/payments/{paymentId}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('paymentId', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        // The signature snake_cases the name, so interpolating `paymentId` raises NameError.
        expect(output).toContain('async def get_payments_by_payment_id(self, payment_id: UUID)');
        expect(output).toContain("f\"/payments/{quote(str(payment_id), safe='')}\"");
        expect(output).not.toContain('{paymentId}');
    });

    it('interpolates a hyphenated path param, which is not a Python identifier', () => {
        const root = opRoot([
            opRoute('/payments/{payment-id}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], paramNodes([opParam('payment-id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        // Previously left untouched, so the literal braces went out on the wire.
        expect(output).toContain("f\"/payments/{quote(str(payment_id), safe='')}\"");
        expect(output).not.toContain('{payment-id}');
    });

    it('reads path params off the params argument when the route declares a model', () => {
        const root = opRoot([
            opRoute('/payments/{paymentId}', [
                opOperation('get', { responses: [opResponse(200, 'Payment')] }),
            ], { kind: 'ref', name: 'PaymentRef' }),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payments_by_payment_id(self, params: PaymentRef)');
        expect(output).toContain("f\"/payments/{quote(str(params.payment_id), safe='')}\"");
    });

    it('leaves a path with no params as a plain string', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'Payment')] })])]);
        const output = generatePythonClient(root);
        expect(output).toContain('"/payments"');
        expect(output).not.toContain('from urllib.parse import quote');
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

    describe('observable-set returns', () => {
        const artBodies = [
            { contentType: 'image/png', bodyType: scalarType('binary') },
            { contentType: 'image/jpeg', bodyType: scalarType('binary') },
        ];

        it('leaves the common success-plus-bodyless-errors method alone', () => {
            const root = opRoot([
                opRoute('/pets', [
                    opOperation('get', { sdk: 'listPets', responses: [opResponse(200, 'Pet', 'application/json'), opResponse(404)] }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('-> Pet:');
            expect(output).toContain('return Pet.model_validate(result)');
            expect(output).not.toContain('expect_statuses');
            expect(output).not.toContain('_fetch_full');
        });

        it('reports which mime came back when a status declares several', () => {
            const root = opRoot([
                opRoute('/art', [
                    opOperation('get', { sdk: 'getArt', responses: [{ statusCode: 200, hasBlock: true, bodies: artBodies }] }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('class GetArtResponse(TypedDict):');
            expect(output).toContain('    content_type: Literal["image/png", "image/jpeg"]');
            expect(output).toContain('    data: bytes');
            expect(output).toContain('-> GetArtResponse:');
            expect(output).toContain('response_kind="auto"');
            expect(output).toContain('if _content_type == "image/jpeg":');
        });

        it('returns a union over every status a client can receive', () => {
            const root = opRoot([
                opRoute('/art', [
                    opOperation('get', {
                        sdk: 'getArt',
                        responses: [opResponse(200, 'Art', 'application/json'), opResponse(304), opResponse(404)],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('class GetArt200Response(TypedDict):');
            expect(output).toContain('    status: Literal[200]');
            expect(output).toContain('class GetArt304Response(TypedDict):');
            expect(output).toContain('-> GetArt200Response | GetArt304Response:');
            expect(output).toContain('expect_statuses=(304,)');
            expect(output).toContain('if _status == 304:');
            // The bare 404 still raises SdkError, so it is not a member.
            expect(output).not.toContain('GetArt404Response');
        });

        it('stops raising for a status declared as a value rather than an error', () => {
            const root = opRoot([
                opRoute('/pets', [
                    opOperation('get', {
                        sdk: 'getPet',
                        responses: [opResponse(200, 'Pet', 'application/json'), opResponse(422, 'Problem', 'application/json')],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('expect_statuses=(422,)');
            expect(output).toContain('if _status == 422:');
        });

        it('gives each status its own headers dict, since Python has no block scope', () => {
            const root = opRoot([
                opRoute('/art', [
                    opOperation('get', {
                        sdk: 'getArt',
                        responses: [
                            { statusCode: 200, hasBlock: true, bodies: artBodies, headers: [{ name: 'etag', optional: true, type: scalarType('string') }] },
                            {
                                statusCode: 202,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: refType('JobRef') }],
                                headers: [{ name: 'retry-after', optional: false, type: scalarType('string') }],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('class GetArt200Headers(TypedDict, total=False):');
            expect(output).toContain('class GetArt202Headers(TypedDict, total=False):');
            expect(output).toContain('headers_200: GetArt200Headers = {}');
            expect(output).toContain('headers_202: GetArt202Headers = {}');
        });
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
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Transfer' } }],
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

        it('annotates and coerces each header to its declared type', () => {
            const root = opRoot([
                opRoute('/things', [
                    opOperation('get', {
                        sdk: 'getThing',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Thing' } }],
                                headers: [
                                    { name: 'x-count', optional: false, type: scalarType('int') },
                                    { name: 'x-ratio', optional: true, type: scalarType('number') },
                                    { name: 'x-cached', optional: false, type: scalarType('boolean') },
                                    { name: 'x-trace', optional: false, type: scalarType('uuid') },
                                    { name: 'x-expires', optional: true, type: scalarType('datetime') },
                                ],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            // The annotation was hardcoded `str`, which discarded the contract's type.
            expect(output).toContain('    x_count: int  # x-count (required)');
            expect(output).toContain('    x_ratio: float  # x-ratio (optional)');
            expect(output).toContain('    x_cached: bool  # x-cached (required)');
            expect(output).toContain('    x_trace: UUID  # x-trace (required)');
            expect(output).toContain('    x_expires: datetime  # x-expires (optional)');
            // ...and the value was assigned raw, so the annotation was also a lie at runtime.
            expect(output).toContain('headers["x_count"] = int(_response_headers["x-count"])');
            expect(output).toContain('headers["x_ratio"] = float(_response_headers["x-ratio"])');
            expect(output).toContain('headers["x_cached"] = _response_headers["x-cached"] == "true"');
            expect(output).toContain('headers["x_trace"] = UUID(_response_headers["x-trace"])');
            expect(output).toContain('headers["x_expires"] = datetime.fromisoformat(_response_headers["x-expires"])');
            // A header-only `datetime` still pulls in the stdlib import it needs.
            expect(output).toContain('from datetime import datetime');
            expect(output).toContain('from uuid import UUID');
        });

        it('rejects a header type that cannot be read from a header', () => {
            const root = opRoot([
                opRoute('/things', [
                    opOperation('get', {
                        sdk: 'getThing',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Thing' } }],
                                headers: [{ name: 'x-window', optional: false, type: scalarType('duration') }],
                            },
                        ],
                    }),
                ]),
            ]);
            // `duration` maps to timedelta, and the standard library has no ISO 8601 duration
            // parser to convert a header string with — so it is refused rather than half-supported.
            expect(() => generatePythonClient(root)).toThrow(/x-window.*GET \/things.*'duration' scalar/s);
        });

        it('returns just headers TypedDict for void ops with declared response headers', () => {
            const root = opRoot([
                opRoute('/resources/{id}', [
                    opOperation('delete', {
                        sdk: 'deleteResource',
                        responses: [
                            {
                                statusCode: 204,
                                hasBlock: true,
                                bodies: [],
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

    // ─── Docstring injection (regression) ─────────────────────────────────

    describe('docstring safety', () => {
        it('escapes """ in op name/description so it cannot close the docstring early', () => {
            const root = opRoot([
                opRoute('/payments', [
                    opOperation('get', {
                        sdk: 'getPayment',
                        name: 'Bad """ name',
                        description: 'desc with """ triple quote',
                        responses: [opResponse(200, 'Payment')],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);

            // The escaped form is emitted...
            expect(output).toContain('Bad \\"\\"\\" name');
            expect(output).toContain('desc with \\"\\"\\" triple quote');

            // ...and the docstring body is only closed by the real delimiter, not the
            // injected one. Between the two `"""` fences there must be exactly the two
            // sanitized body lines and nothing that terminates early.
            const idx = output.indexOf('async def get_payment');
            const body = output.slice(idx);
            const open = body.indexOf('        """');
            const close = body.indexOf('        """', open + 1);
            const between = body.slice(open + '        """'.length, close);
            expect(between).not.toMatch(/"""/); // no unescaped triple-quote inside the docstring
            // The method body after the docstring is intact.
            expect(body.slice(close)).toContain('await self._fetch');
        });

        it('guards a trailing backslash in a description', () => {
            const root = opRoot([
                opRoute('/payments', [
                    opOperation('get', {
                        sdk: 'getPayment',
                        description: 'ends with backslash\\',
                        responses: [opResponse(200, 'Payment')],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            // Trailing backslash is neutralized (space appended) so it can't escape the delimiter.
            expect(output).toContain('        ends with backslash\\ \n');
        });

        it('keeps each line of a multi-line description indented in the docstring', () => {
            const root = opRoot([
                opRoute('/payments', [
                    opOperation('get', {
                        sdk: 'getPayment',
                        description: 'first line\nsecond line',
                        responses: [opResponse(200, 'Payment')],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('        first line');
            expect(output).toContain('        second line');
        });
    });
});

// ─── BASE_CLIENT_PY ───────────────────────────────────────────────────────

describe('BASE_CLIENT_PY', () => {
    it('routes each body_kind to the httpx kwarg that serializes it', () => {
        expect(BASE_CLIENT_PY).toContain('request_kwargs["json"] = body');
        expect(BASE_CLIENT_PY).toContain('request_kwargs["data"] = body');
        expect(BASE_CLIENT_PY).toContain('request_kwargs["files"] = body');
        expect(BASE_CLIENT_PY).toContain('request_kwargs["content"] = body');
    });

    it('leaves Content-Type to httpx for multipart, so it can generate the boundary', () => {
        // A multipart Content-Type set here would carry no boundary parameter, and no server
        // can parse that. Every other body kind still gets its declared content type.
        expect(BASE_CLIENT_PY).toContain('if body is not None and body_kind != "multipart":');
    });
});
