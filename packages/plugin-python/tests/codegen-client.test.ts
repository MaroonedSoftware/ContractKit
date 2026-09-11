import { describe, it, expect } from 'vitest';
import { generatePythonClient, deriveClientClassName, deriveClientModuleName, hasPublicOperations, BASE_CLIENT_PY } from '../src/codegen-client.js';
import {
    scalarType,
    arrayType,
    tupleType,
    refType,
    enumType,
    recordType,
    unionType,
    inlineObjectType,
    opParam,
    paramNodes,
    paramRef,
    paramType,
    opRequest,
    opResponse,
    opOperation,
    opRoute,
    opRoot,
    type ContractTypeNode,
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
        const root = opRoot([opRoute('/internal', [opOperation('get')], undefined, ['internal'])]);
        expect(hasPublicOperations(root)).toBe(false);
    });

    it('returns true when at least one public op exists', () => {
        const root = opRoot([opRoute('/public', [opOperation('get')])]);
        expect(hasPublicOperations(root)).toBe(true);
    });
});

// ─── generatePythonClient ─────────────────────────────────────────────────

describe('generatePythonClient', () => {
    it('generates a class with the right name', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'Payment')] })])], 'payments.op.ck');
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
        const root = opRoot(
            [
                opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'array(Payment)')] })]),
                opRoute(
                    '/payments/{id}',
                    [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                    paramNodes([opParam('id', scalarType('uuid'))]),
                ),
                opRoute('/payments', [opOperation('post', { request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment')] })]),
            ],
            'payments.op.ck',
        );
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payments(self)');
        expect(output).toContain('async def get_payments_by_id(self, id: UUID)');
        expect(output).toContain('async def post_payments(self, body: PaymentInput)');
    });

    it('uses op.sdk name when provided (converted to snake_case)', () => {
        const root = opRoot([
            opRoute(
                '/payments/{id}',
                [opOperation('get', { sdk: 'getPayment', responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('id', scalarType('uuid'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payment(self, id: UUID)');
    });

    it('uses op.name as method name when op.sdk is not set', () => {
        const root = opRoot([opRoute('/payments', [opOperation('post', { name: 'Create a Payment', responses: [opResponse(201, 'Payment')] })])]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def create_a_payment(self)');
    });

    it('prefers op.sdk over op.name as method name', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('post', { sdk: 'makePayment', name: 'Create a Payment', responses: [opResponse(201, 'Payment')] })]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def make_payment(self)');
        expect(output).not.toContain('create_a_payment');
    });

    it('escapes a method name and a path parameter that are Python keywords', () => {
        const root = opRoot([
            opRoute(
                '/imports/{from}',
                [opOperation('put', { sdk: 'import', responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('from', scalarType('string'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def import_(self, from_: str)');
        expect(output).toContain('f"/imports/{quote(str(from_), safe=\'\')}"');
        expect(output).not.toContain('def import(');
    });

    it('generates void return for operations with no body', () => {
        const root = opRoot([
            opRoute('/payments/{id}', [opOperation('delete', { responses: [opResponse(204)] })], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('-> None:');
        expect(output).toContain('return None');
    });

    it('generates model_validate for model responses', () => {
        const root = opRoot([
            opRoute(
                '/payments/{id}',
                [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('id', scalarType('uuid'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('Payment.model_validate(result)');
    });

    it('validates an array-of-model response through a module-level TypeAdapter', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'array(Payment)')] })])]);
        const output = generatePythonClient(root);
        expect(output).toContain('_GET_PAYMENTS_RESPONSE: TypeAdapter[list[Payment]] = TypeAdapter(list[Payment])');
        expect(output).toContain('return _GET_PAYMENTS_RESPONSE.validate_python(result)');
    });

    describe('response validation', () => {
        const discriminated: ContractTypeNode = { kind: 'discriminatedUnion', discriminator: 'kind', members: [refType('Card'), refType('Bank')] };

        it('validates every JSON response that is not a single model, not just lists of models', () => {
            const root = opRoot([
                opRoute('/a', [opOperation('get', { sdk: 'byId', responses: [opResponse(200, recordType(scalarType('string'), refType('Item')))] })]),
                opRoute('/b', [opOperation('get', { sdk: 'anyMethod', responses: [opResponse(200, unionType(refType('Card'), refType('Bank')))] })]),
                opRoute('/c', [opOperation('get', { sdk: 'tagged', responses: [opResponse(200, discriminated)] })]),
                opRoute('/d', [opOperation('get', { sdk: 'counts', responses: [opResponse(200, arrayType(scalarType('bigint')))] })]),
                opRoute('/e', [opOperation('get', { sdk: 'days', responses: [opResponse(200, arrayType(scalarType('date')))] })]),
                opRoute('/f', [
                    opOperation('get', { sdk: 'pair', responses: [opResponse(200, tupleType(scalarType('date'), scalarType('decimal')))] }),
                ]),
            ]);
            const output = generatePythonClient(root);
            // Returned raw, each of these was decoded JSON under a lying annotation: plain dicts for
            // the models, and the wire strings for bigint, date and Decimal.
            expect(output).toContain('_BY_ID_RESPONSE: TypeAdapter[dict[str, Item]] = TypeAdapter(dict[str, Item])');
            expect(output).toContain('_ANY_METHOD_RESPONSE: TypeAdapter[Card | Bank] = TypeAdapter(Card | Bank)');
            expect(output).toContain(
                '_TAGGED_RESPONSE: TypeAdapter[Annotated[Card | Bank, Field(discriminator="kind")]] = TypeAdapter(Annotated[Card | Bank, Field(discriminator="kind")])',
            );
            expect(output).toContain('_COUNTS_RESPONSE: TypeAdapter[list[BigInt]] = TypeAdapter(list[BigInt])');
            expect(output).toContain('_DAYS_RESPONSE: TypeAdapter[list[date]] = TypeAdapter(list[date])');
            expect(output).toContain('_PAIR_RESPONSE: TypeAdapter[tuple[date, Decimal]] = TypeAdapter(tuple[date, Decimal])');
            expect(output).toContain('return _BY_ID_RESPONSE.validate_python(result)');
            expect(output).toContain('return _COUNTS_RESPONSE.validate_python(result)');
            expect(output).not.toMatch(/^\s+return result$/m);
            // The adapters are evaluated at import, so everything their types name is imported.
            expect(output).toContain('from pydantic import Field, TypeAdapter');
            expect(output).toContain('from ._scalars import BigInt');
            expect(output).toContain('from datetime import date');
            expect(output).toContain('from decimal import Decimal');
        });

        it('keeps model_validate for a single model and adds no adapter for Any, text or binary', () => {
            const root = opRoot([
                opRoute('/m', [opOperation('get', { sdk: 'getModel', responses: [opResponse(200, 'Item')] })]),
                opRoute('/j', [opOperation('get', { sdk: 'getJson', responses: [opResponse(200, scalarType('json'))] })]),
                opRoute('/t', [opOperation('get', { sdk: 'getText', responses: [opResponse(200, scalarType('string'), 'text/plain')] })]),
                opRoute('/b', [
                    opOperation('get', { sdk: 'getBytes', responses: [opResponse(200, scalarType('binary'), 'application/octet-stream')] }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).not.toContain('TypeAdapter');
            expect(output).toContain('return Item.model_validate(result)');
        });

        it('validates a response typed by a type-alias contract through an adapter', () => {
            const root = opRoot([opRoute('/tier', [opOperation('get', { sdk: 'getTier', responses: [opResponse(200, 'Tier')] })])]);
            const output = generatePythonClient(root, { typeAliases: new Set(['Tier']) });
            expect(output).toContain('_GET_TIER_RESPONSE: TypeAdapter[Tier] = TypeAdapter(Tier)');
            expect(output).toContain('return _GET_TIER_RESPONSE.validate_python(result)');
        });

        it('validates the body alongside declared response headers', () => {
            const root = opRoot([
                opRoute('/days', [
                    opOperation('get', {
                        sdk: 'days',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: arrayType(scalarType('date')) }],
                                headers: [{ name: 'etag', optional: true, type: scalarType('string') }],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('return _DAYS_RESPONSE.validate_python(result), headers');
        });

        it('names one adapter per status when a method reports several', () => {
            const root = opRoot([
                opRoute('/multi', [
                    opOperation('get', {
                        sdk: 'multi',
                        responses: [
                            opResponse(200, recordType(scalarType('string'), refType('Item'))),
                            opResponse(202, arrayType(scalarType('date'))),
                            opResponse(409, 'Item'),
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('_MULTI_RESPONSE_200: TypeAdapter[dict[str, Item]] = TypeAdapter(dict[str, Item])');
            expect(output).toContain('_MULTI_RESPONSE_202: TypeAdapter[list[date]] = TypeAdapter(list[date])');
            expect(output).toContain('"data": _MULTI_RESPONSE_202.validate_python(result)');
            expect(output).toContain('"data": _MULTI_RESPONSE_200.validate_python(result)');
            expect(output).toContain('"data": Item.model_validate(result)');
        });

        it('shares an adapter across mimes of one type and tells a second type apart by its mime', () => {
            const root = opRoot([
                opRoute('/mime', [
                    opOperation('get', {
                        sdk: 'mime',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [
                                    { contentType: 'application/json', bodyType: arrayType(scalarType('bigint')) },
                                    { contentType: 'application/vnd.api+json', bodyType: arrayType(scalarType('bigint')) },
                                    { contentType: 'application/vnd.map+json', bodyType: recordType(scalarType('string'), scalarType('bigint')) },
                                    { contentType: 'text/csv', bodyType: scalarType('string') },
                                ],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            expect(output.match(/^_MIME_RESPONSE\w*(?=: TypeAdapter)/gm)).toEqual(['_MIME_RESPONSE', '_MIME_RESPONSE_VND_MAP_JSON']);
            expect(output).toContain('_MIME_RESPONSE: TypeAdapter[list[BigInt]] = TypeAdapter(list[BigInt])');
            expect(output).toContain('_MIME_RESPONSE_VND_MAP_JSON: TypeAdapter[dict[str, BigInt]] = TypeAdapter(dict[str, BigInt])');
            expect(output).toContain('return { "content_type": "application/vnd.api+json", "data": _MIME_RESPONSE.validate_python(result) }');
            expect(output).toContain(
                'return { "content_type": "application/vnd.map+json", "data": _MIME_RESPONSE_VND_MAP_JSON.validate_python(result) }',
            );
            expect(output).toContain('return { "content_type": "text/csv", "data": result }');
        });
    });

    it('emits a TypedDict for an inline query block and requires it when its fields are', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // A bare `dict` told a type checker nothing about what the request accepts, while the
        // router has always validated these fields.
        expect(output).toContain('GetPaymentsQuery = TypedDict("GetPaymentsQuery", {');
        expect(output).toContain('    "page": int,');
        expect(output).toContain('    "limit": int,');
        expect(output).toContain('query: GetPaymentsQuery');
        expect(output).toContain('params=query');
    });

    it('imports every type a request TypedDict evaluates when the module loads', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [
                        opParam('status', enumType('open', 'closed'), { optional: true }),
                        opParam('wait', scalarType('duration'), { optional: true }),
                        opParam(
                            'kind',
                            {
                                kind: 'discriminatedUnion',
                                discriminator: 'type',
                                members: [refType('Card'), refType('Bank')],
                            } as never,
                            { optional: true },
                        ),
                    ],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // Class-syntax annotations were lazy, so these were never needed; the functional form
        // evaluates its values at import, and a missing one is a NameError.
        expect(output).toContain('from typing import Annotated, Literal, NotRequired, TypedDict');
        expect(output).toContain('from datetime import timedelta');
        expect(output).toContain('from pydantic import Field');
        expect(output).toContain('    "kind": NotRequired[Annotated[Card | Bank, Field(discriminator="type")]],');
    });

    it('imports BigInt wherever a request or response type carries a bigint', () => {
        const root = opRoot([
            opRoute('/counts', [
                opOperation('get', {
                    query: [opParam('since', scalarType('bigint'), { optional: true })],
                    responses: [opResponse(200, arrayType(scalarType('bigint')))],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // The TypedDict evaluates `BigInt` at import, so the name has to be really imported.
        expect(output).toContain('from ._scalars import BigInt');
        expect(output).toContain('    "since": NotRequired[BigInt],');
    });

    it('keys query and header TypedDicts by the names that go on the wire', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [opParam('pageSize', scalarType('int'), { optional: true }), opParam('from', scalarType('string'), { optional: true })],
                    headers: [opParam('x-tenant', scalarType('string'))],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // The dict is sent as-is, so a snake_cased `x_tenant` key is a different header to the
        // server and `page_size` an unknown query key. `from` and `x-tenant` cannot be keys in
        // the class syntax at all.
        expect(output).toContain('    "pageSize": NotRequired[int],');
        expect(output).toContain('    "from": NotRequired[str],');
        expect(output).toContain('GetPaymentsHeaders = TypedDict("GetPaymentsHeaders", {\n    "x-tenant": str,\n})');
        expect(output).toContain('params=query, extra_headers=custom_headers');
    });

    it('marks omittable fields NotRequired and makes the argument optional', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [opParam('page', scalarType('int'), { optional: true }), opParam('limit', scalarType('int'), { default: 20 })],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // `NotRequired` rather than `total=False`, so a required field in a mixed block stays so.
        expect(output).toContain('    "page": NotRequired[int],');
        expect(output).toContain('    "limit": NotRequired[int],');
        expect(output).toContain('from typing import NotRequired, TypedDict');
        expect(output).toContain('query: GetPaymentsQuery | None = None');
    });

    it('widens an optional argument that precedes a required one', () => {
        const root = opRoot([
            opRoute('/payments', [
                opOperation('get', {
                    query: [opParam('page', scalarType('int'), { optional: true })],
                    headers: [opParam('x-tenant', scalarType('string'))],
                    responses: [opResponse(200, 'array(Payment)')],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        // In Python a defaulted parameter before a bare one is a SyntaxError, not a type error.
        expect(output).toContain('query: GetPaymentsQuery, custom_headers: GetPaymentsHeaders');
        expect(output).not.toContain('query: GetPaymentsQuery | None = None, custom_headers');
    });

    it('leaves a query declared as a model ref alone', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { query: paramRef('PaymentFilter'), responses: [opResponse(200, 'array(Payment)')] })]),
        ]);
        const output = generatePythonClient(root);
        // Deciding optionality needs the model's own fields, which this generator does not have.
        expect(output).toContain('query: PaymentFilter | None = None');
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
        // by_alias: a renamed field goes out as `unitPrice`, not `unit_price`, which a strict server
        // schema rejects. exclude_unset: an optional the caller never set is omitted rather than
        // sent as null, which `.optional()` rejects.
        expect(output).toContain('body=body.model_dump(mode="json", by_alias=True, exclude_unset=True)');
    });

    it('serializes a list-of-model body through a module-level TypeAdapter', () => {
        const modelsWithInput = new Set(['Item']);
        const root = opRoot([
            opRoute('/items', [
                opOperation('post', { sdk: 'createItems', request: opRequest(arrayType(refType('Item'))), responses: [opResponse(204)] }),
            ]),
        ]);
        const output = generatePythonClient(root, { modelsWithInput });
        // Sent raw, a list of Pydantic objects fails in httpx: "Object of type Item is not JSON
        // serializable". Built once at import, not per call.
        expect(output).toContain('from pydantic import TypeAdapter');
        expect(output).toContain('_CREATE_ITEMS_BODY: TypeAdapter[list[ItemInput]] = TypeAdapter(list[ItemInput])');
        expect(output).toContain('async def create_items(self, body: list[ItemInput]) -> None:');
        expect(output).toContain('body=_CREATE_ITEMS_BODY.dump_python(body, mode="json", by_alias=True, exclude_unset=True)');
    });

    it('serializes record, union and inline-object bodies the same way', () => {
        const root = opRoot([
            opRoute('/a', [
                opOperation('put', {
                    sdk: 'putRecord',
                    request: opRequest(recordType(scalarType('string'), refType('Item'))),
                    responses: [opResponse(204)],
                }),
            ]),
            opRoute('/b', [
                opOperation('put', {
                    sdk: 'putUnion',
                    request: opRequest(unionType(refType('Card'), refType('Bank'))),
                    responses: [opResponse(204)],
                }),
            ]),
            opRoute('/c', [opOperation('put', { sdk: 'putObject', request: opRequest(inlineObjectType([])), responses: [opResponse(204)] })]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('_PUT_RECORD_BODY: TypeAdapter[dict[str, Item]] = TypeAdapter(dict[str, Item])');
        expect(output).toContain('_PUT_UNION_BODY: TypeAdapter[Card | Bank] = TypeAdapter(Card | Bank)');
        // An inline object is `dict[str, Any]`, whose values may be dates or Decimals.
        expect(output).toContain('_PUT_OBJECT_BODY: TypeAdapter[dict[str, Any]] = TypeAdapter(dict[str, Any])');
        expect(output).toContain('body=_PUT_UNION_BODY.dump_python(body, mode="json", by_alias=True, exclude_unset=True)');
    });

    it('builds the adapter for a urlencoded body that is not a single model', () => {
        const root = opRoot([
            opRoute('/forms', [
                opOperation('post', {
                    sdk: 'postForm',
                    request: opRequest(recordType(scalarType('string'), scalarType('date')), 'application/x-www-form-urlencoded'),
                    responses: [opResponse(204)],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('_POST_FORM_BODY: TypeAdapter[dict[str, date]] = TypeAdapter(dict[str, date])');
        expect(output).toContain('body_kind="form"');
    });

    it('sends a body typed by a type-alias contract through an adapter, not model_dump', () => {
        const root = opRoot([
            opRoute('/tier', [opOperation('put', { sdk: 'putTier', request: opRequest('Tier'), responses: [opResponse(204)] })]),
            opRoute('/card', [opOperation('put', { sdk: 'putCard', request: opRequest('Card'), responses: [opResponse(204)] })]),
        ]);
        const output = generatePythonClient(root, { typeAliases: new Set(['Tier']) });
        // `Tier = Literal["free", "pro"]`: the caller passes a str, which has no `model_dump`.
        expect(output).toContain('_PUT_TIER_BODY: TypeAdapter[Tier] = TypeAdapter(Tier)');
        expect(output).toContain('body=_PUT_TIER_BODY.dump_python(body, mode="json", by_alias=True, exclude_unset=True)');
        expect(output).toContain('body=body.model_dump(mode="json", by_alias=True, exclude_unset=True)');
        expect(output).not.toContain('_PUT_CARD_BODY');
    });

    it('never calls model_validate on a type-alias contract', () => {
        const root = opRoot([
            opRoute('/tier', [opOperation('get', { sdk: 'getTier', responses: [opResponse(200, 'Tier')] })]),
            opRoute('/tiers', [opOperation('get', { sdk: 'listTiers', responses: [opResponse(200, 'array(Tier)')] })]),
        ]);
        const output = generatePythonClient(root, { typeAliases: new Set(['Tier']) });
        expect(output).not.toContain('Tier.model_validate');
    });

    it('leaves single-model, multipart, text and binary bodies without an adapter', () => {
        const root = opRoot([
            opRoute('/m', [opOperation('post', { sdk: 'postModel', request: opRequest('Item'), responses: [opResponse(204)] })]),
            opRoute('/f', [
                opOperation('post', { sdk: 'postFile', request: opRequest('Upload', 'multipart/form-data'), responses: [opResponse(204)] }),
            ]),
            opRoute('/t', [
                opOperation('post', { sdk: 'postText', request: opRequest(scalarType('string'), 'text/plain'), responses: [opResponse(204)] }),
            ]),
            opRoute('/b', [
                opOperation('post', {
                    sdk: 'postBytes',
                    request: opRequest(scalarType('binary'), 'application/octet-stream'),
                    responses: [opResponse(204)],
                }),
            ]),
        ]);
        const output = generatePythonClient(root);
        expect(output).not.toContain('TypeAdapter');
        expect(output).toContain('body=body.model_dump(mode="json", by_alias=True, exclude_unset=True)');
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
        // Form keys are contract names too, and an unset optional must not become `note=`.
        expect(output).toContain('body=body.model_dump(mode="json", by_alias=True, exclude_unset=True)');
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
        // could never have supplied a boundary of their own. Parameterized, for mypy --strict.
        expect(output).toContain('body: dict[str, Any]');
        expect(output).toContain('from typing import Any');
    });

    it('types an inline block that declares nothing as dict[str, Any]', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('get', { sdk: 'listPayments', query: paramNodes([]), responses: [opResponse(204)] })]),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('query: dict[str, Any] | None = None');
        expect(output).toContain('from typing import Any');
    });

    it('leaves a JSON body on the json= path with no body_kind', () => {
        const root = opRoot([
            opRoute('/payments', [opOperation('post', { request: opRequest('PaymentInput'), responses: [opResponse(201, 'Payment')] })]),
        ]);
        const output = generatePythonClient(root);
        expect(output).not.toContain('body_kind=');
    });

    it('generates path param interpolation in f-string', () => {
        const root = opRoot([
            opRoute(
                '/payments/{id}',
                [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('id', scalarType('uuid'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('f"/payments/{quote(str(id), safe=\'\')}"');
        expect(output).toContain('from urllib.parse import quote');
    });

    it('interpolates the snake_cased name the signature actually binds', () => {
        const root = opRoot([
            opRoute(
                '/payments/{paymentId}',
                [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('paymentId', scalarType('uuid'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        // The signature snake_cases the name, so interpolating `paymentId` raises NameError.
        expect(output).toContain('async def get_payments_by_payment_id(self, payment_id: UUID)');
        expect(output).toContain('f"/payments/{quote(str(payment_id), safe=\'\')}"');
        expect(output).not.toContain('{paymentId}');
    });

    it('interpolates a hyphenated path param, which is not a Python identifier', () => {
        const root = opRoot([
            opRoute(
                '/payments/{payment-id}',
                [opOperation('get', { responses: [opResponse(200, 'Payment')] })],
                paramNodes([opParam('payment-id', scalarType('uuid'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        // Previously left untouched, so the literal braces went out on the wire.
        expect(output).toContain('f"/payments/{quote(str(payment_id), safe=\'\')}"');
        expect(output).not.toContain('{payment-id}');
    });

    it('reads path params off the params argument when the route declares a model', () => {
        const root = opRoot([
            opRoute('/payments/{paymentId}', [opOperation('get', { responses: [opResponse(200, 'Payment')] })], { kind: 'ref', name: 'PaymentRef' }),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('async def get_payments_by_payment_id(self, params: PaymentRef)');
        expect(output).toContain("f\"/payments/{quote(str(params.model_dump(by_alias=True)['paymentId']), safe='')}\"");
    });

    it('escapes a path param named after a Python keyword, in the signature and the URL', () => {
        const root = opRoot([
            opRoute(
                '/seats/{class}',
                [opOperation('get', { sdk: 'getSeat', responses: [opResponse(200, 'Seat')] })],
                paramNodes([opParam('class', scalarType('string'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        // `def get_seat(self, class: str)` is a SyntaxError for the whole module.
        expect(output).toContain('async def get_seat(self, class_: str)');
        expect(output).toContain('f"/seats/{quote(str(class_), safe=\'\')}"');
    });

    it('reads a params model by contract name, whatever the model calls the attribute', () => {
        const root = opRoot([
            opRoute('/rows/{class}', [opOperation('get', { sdk: 'getRow', responses: [opResponse(200, 'Seat')] })], paramRef('SeatRef')),
        ]);
        const output = generatePythonClient(root);
        // The model names the field `class_`, and would name a defaulted `date` field `date_`,
        // decisions that depend on fields this generator never sees.
        expect(output).toContain("f\"/rows/{quote(str(params.model_dump(by_alias=True)['class']), safe='')}\"");
    });

    it('keeps a path param clear of the arguments and functions the method already uses', () => {
        const root = opRoot([
            opRoute(
                '/notes/{body}/{quote}',
                [opOperation('post', { sdk: 'postNote', request: opRequest('Note'), responses: [opResponse(204)] })],
                paramNodes([opParam('body', scalarType('string')), opParam('quote', scalarType('string'))]),
            ),
        ]);
        const output = generatePythonClient(root);
        // A second `body` is a duplicate-argument SyntaxError; a `quote` argument shadows
        // urllib.parse.quote, so the URL expression would call a string.
        expect(output).toContain('async def post_note(self, body_: str, quote_: str, body: Note)');
        expect(output).toContain("f\"/notes/{quote(str(body_), safe='')}/{quote(str(quote_), safe='')}\"");
    });

    it('leaves a path param named after a soft keyword alone', () => {
        const root = opRoot([
            opRoute(
                '/kinds/{type}',
                [opOperation('get', { sdk: 'getKind', responses: [opResponse(200, 'Kind')] })],
                paramNodes([opParam('type', scalarType('string'))]),
            ),
        ]);
        expect(generatePythonClient(root)).toContain('async def get_kind(self, type: str)');
    });

    it('leaves a path with no params as a plain string', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get', { responses: [opResponse(200, 'Payment')] })])]);
        const output = generatePythonClient(root);
        expect(output).toContain('"/payments"');
        expect(output).not.toContain('from urllib.parse import quote');
    });

    it('imports model types from their modules', () => {
        const modelModulePaths = new Map([
            ['Payment', '._models_payment'],
            ['PaymentInput', '._models_payment'],
        ]);
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
            opRoute('/payments/{id}', [opOperation('get', { responses: [opResponse(204)] })], paramNodes([opParam('id', scalarType('uuid'))])),
        ]);
        const output = generatePythonClient(root);
        expect(output).toContain('from uuid import UUID');
    });

    it('adds deprecated comment for deprecated operations', () => {
        const root = opRoot([opRoute('/old', [opOperation('get', { responses: [opResponse(200, 'User')] })], undefined, ['deprecated'])]);
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
        expect(output).toContain('body=body.model_dump(mode="json", by_alias=True, exclude_unset=True)');
    });

    describe('observable-set returns', () => {
        const artBodies = [
            { contentType: 'image/png', bodyType: scalarType('binary') },
            { contentType: 'image/jpeg', bodyType: scalarType('binary') },
        ];

        it('leaves the common success-plus-bodyless-errors method alone', () => {
            const root = opRoot([
                opRoute('/pets', [opOperation('get', { sdk: 'listPets', responses: [opResponse(200, 'Pet', 'application/json'), opResponse(404)] })]),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('-> Pet:');
            expect(output).toContain('return Pet.model_validate(result)');
            expect(output).not.toContain('expect_statuses');
            expect(output).not.toContain('_fetch_full');
        });

        it('reports which mime came back when a status declares several', () => {
            const root = opRoot([
                opRoute('/art', [opOperation('get', { sdk: 'getArt', responses: [{ statusCode: 200, hasBlock: true, bodies: artBodies }] })]),
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
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: artBodies,
                                headers: [{ name: 'etag', optional: true, type: scalarType('string') }],
                            },
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
                opRoute(
                    '/transfers/{id}',
                    [
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
                    ],
                    paramNodes([opParam('id', scalarType('uuid'))]),
                ),
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

        it('escapes a response header named after a Python keyword', () => {
            const root = opRoot([
                opRoute('/mail', [
                    opOperation('get', {
                        sdk: 'getMail',
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: { kind: 'ref', name: 'Mail' } }],
                                headers: [{ name: 'from', optional: true, type: scalarType('string') }],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generatePythonClient(root);
            // The HTTP `From` header: `from: str` in the TypedDict body is a SyntaxError.
            expect(output).toContain('    from_: str  # from (optional)');
            expect(output).toContain('headers["from_"] = _response_headers["from"]');
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
                opRoute(
                    '/resources/{id}',
                    [
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
                    ],
                    paramNodes([opParam('id', scalarType('uuid'))]),
                ),
            ]);
            const output = generatePythonClient(root);
            expect(output).toContain('class DeleteResourceHeaders(TypedDict, total=False):');
            expect(output).toContain('-> DeleteResourceHeaders:');
            expect(output).toContain('return headers');
        });

        it('keeps plain return type when no response headers are declared', () => {
            const root = opRoot([
                opRoute(
                    '/users/{id}',
                    [opOperation('get', { sdk: 'getUser', responses: [opResponse(200, 'User')] })],
                    paramNodes([opParam('id', scalarType('uuid'))]),
                ),
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

    it('dumps a model-ref query or headers by contract name, like a request body', () => {
        // Passed straight through, httpx raised on a model query and the header merge on a model.
        expect(BASE_CLIENT_PY).toContain('data = values.model_dump(mode="json", by_alias=True, exclude_unset=True)');
        expect(BASE_CLIENT_PY).toContain('"params": _wire_values(params)');
    });

    it('converts inline query and header values to the forms the router parses', () => {
        // httpx str()s a datetime with a space, which Luxon's fromISO rejects.
        expect(BASE_CLIENT_PY).toContain('data = to_jsonable_python(dict(values))');
        // A None became an empty value, which a numeric schema rejects.
        expect(BASE_CLIENT_PY).toContain('if value is not None}');
    });

    it('sends every header value as text, since httpx rejects anything else', () => {
        expect(BASE_CLIENT_PY).toContain('**{key: _header_text(value) for key, value in _wire_values(extra_headers).items()}');
        expect(BASE_CLIENT_PY).toContain('return "true" if value else "false"');
    });

    it('accepts a TypedDict or a model wherever query or headers are passed', () => {
        // A TypedDict is a Mapping but not a dict to a type checker.
        expect(BASE_CLIENT_PY).not.toContain('params: dict | None');
        expect(BASE_CLIENT_PY.match(/params: Mapping\[str, Any\] \| BaseModel \| None = None/g)).toHaveLength(3);
        expect(BASE_CLIENT_PY.match(/extra_headers: Mapping\[str, Any\] \| BaseModel \| None = None/g)).toHaveLength(3);
    });
});
