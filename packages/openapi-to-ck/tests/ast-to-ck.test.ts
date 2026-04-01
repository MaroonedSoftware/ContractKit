import { describe, it, expect } from 'vitest';
import { astToCk, serializeType } from '../src/ast-to-ck.js';
import {
    ckRoot,
    model,
    field,
    scalarType,
    arrayType,
    tupleType,
    recordType,
    enumType,
    literalType,
    unionType,
    intersectionType,
    refType,
    inlineObjectType,
    lazyType,
    opRoute,
    opOperation,
    opParam,
    opRequest,
    opResponse,
} from './helpers.js';

// ─── Type Serialization ───────────────────────────────────────────────────

describe('serializeType', () => {
    it('serializes scalar types', () => {
        expect(serializeType(scalarType('string'))).toBe('string');
        expect(serializeType(scalarType('int'))).toBe('int');
        expect(serializeType(scalarType('boolean'))).toBe('boolean');
        expect(serializeType(scalarType('uuid'))).toBe('uuid');
        expect(serializeType(scalarType('email'))).toBe('email');
        expect(serializeType(scalarType('datetime'))).toBe('datetime');
        expect(serializeType(scalarType('binary'))).toBe('binary');
    });

    it('serializes scalar types with constraints', () => {
        expect(serializeType(scalarType('string', { min: 1, max: 100 }))).toBe('string(min=1, max=100)');
        expect(serializeType(scalarType('string', { len: 3 }))).toBe('string(length=3)');
        expect(serializeType(scalarType('string', { regex: '/^[a-z]+$/' }))).toBe('string(regex=/^[a-z]+$/)');
        expect(serializeType(scalarType('int', { min: 0 }))).toBe('int(min=0)');
        expect(serializeType(scalarType('int', { min: 0, max: 100 }))).toBe('int(min=0, max=100)');
    });

    it('serializes array types', () => {
        expect(serializeType(arrayType(scalarType('string')))).toBe('array(string)');
        expect(serializeType(arrayType(refType('User'), { min: 1 }))).toBe('array(User, min=1)');
        expect(serializeType(arrayType(scalarType('int'), { min: 0, max: 10 }))).toBe('array(int, min=0, max=10)');
    });

    it('serializes tuple types', () => {
        expect(serializeType(tupleType(scalarType('string'), scalarType('int')))).toBe('tuple(string, int)');
    });

    it('serializes record types', () => {
        expect(serializeType(recordType(scalarType('string'), scalarType('int')))).toBe('record(string, int)');
    });

    it('serializes enum types', () => {
        expect(serializeType(enumType('asc', 'desc'))).toBe('enum(asc, desc)');
        expect(serializeType(enumType('credit', 'debit'))).toBe('enum(credit, debit)');
    });

    it('serializes literal types', () => {
        expect(serializeType(literalType('hello'))).toBe('literal("hello")');
        expect(serializeType(literalType(42))).toBe('literal(42)');
        expect(serializeType(literalType(true))).toBe('literal(true)');
    });

    it('serializes union types', () => {
        expect(serializeType(unionType(scalarType('string'), scalarType('int')))).toBe('string | int');
    });

    it('serializes intersection types', () => {
        expect(serializeType(intersectionType(refType('A'), refType('B')))).toBe('A & B');
    });

    it('serializes ref types', () => {
        expect(serializeType(refType('User'))).toBe('User');
    });

    it('serializes lazy types', () => {
        expect(serializeType(lazyType(refType('Category')))).toBe('lazy(Category)');
    });

    it('serializes inline object types', () => {
        const type = inlineObjectType([field('name', scalarType('string')), field('age', scalarType('int'))]);
        const result = serializeType(type);
        expect(result).toContain('{');
        expect(result).toContain('name: string');
        expect(result).toContain('age: int');
    });
});

// ─── Model Serialization ──────────────────────────────────────────────────

describe('model serialization', () => {
    it('serializes a simple model with fields', () => {
        const root = ckRoot({
            models: [
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('name', scalarType('string', { min: 3, max: 100 })),
                    field('email', scalarType('email')),
                    field('bio', scalarType('string'), { optional: true }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('contract User: {');
        expect(result).toContain('    id: readonly uuid');
        expect(result).toContain('    name: string(min=3, max=100)');
        expect(result).toContain('    email: email');
        expect(result).toContain('    bio?: string');
        expect(result).toContain('}');
    });

    it('serializes model with descriptions as comments', () => {
        const root = ckRoot({
            models: [model('User', [field('id', scalarType('uuid'), { description: 'The user ID' })], { description: 'A user' })],
        });
        const result = astToCk(root);
        expect(result).toContain('contract User: { # A user');
        expect(result).toContain('    id: uuid # The user ID');
    });

    it('omits comments when includeComments is false', () => {
        const root = ckRoot({
            models: [model('User', [field('id', scalarType('uuid'), { description: 'The user ID' })], { description: 'A user' })],
        });
        const result = astToCk(root, { includeComments: false });
        expect(result).not.toContain('#');
    });

    it('serializes model with default values', () => {
        const root = ckRoot({
            models: [
                model('Pagination', [
                    field('page', scalarType('int', { min: 0 }), { default: 0 }),
                    field('pageSize', scalarType('int', { min: 1, max: 100 }), { default: 25 }),
                    field('sort', enumType('asc', 'desc'), { default: 'desc' }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('    page: int(min=0) = 0');
        expect(result).toContain('    pageSize: int(min=1, max=100) = 25');
        expect(result).toContain('    sort: enum(asc, desc) = desc');
    });

    it('serializes model with inheritance', () => {
        const root = ckRoot({
            models: [model('Admin', [field('role', enumType('admin', 'superadmin'))], { base: 'User' })],
        });
        const result = astToCk(root);
        expect(result).toContain('contract Admin: User & {');
    });

    it('serializes model type alias', () => {
        const root = ckRoot({
            models: [model('UserId', [], { type: scalarType('uuid') })],
        });
        const result = astToCk(root);
        expect(result).toContain('contract UserId: uuid');
    });

    it('serializes model with mode and inputCase modifiers', () => {
        const root = ckRoot({
            models: [model('WebhookData', [field('event', scalarType('string'))], { mode: 'loose', inputCase: 'snake' })],
        });
        const result = astToCk(root);
        expect(result).toContain('contract format(input=snake) mode(loose) WebhookData: {');
    });

    it('serializes nullable fields', () => {
        const root = ckRoot({
            models: [model('Item', [field('parentId', scalarType('uuid'), { nullable: true, optional: true })])],
        });
        const result = astToCk(root);
        expect(result).toContain('    parentId?: uuid | null');
    });

    it('serializes deprecated models', () => {
        const root = ckRoot({
            models: [model('OldUser', [field('id', scalarType('uuid'))], { deprecated: true })],
        });
        const result = astToCk(root);
        expect(result).toContain('contract deprecated OldUser: {');
    });
});

// ─── Options Block ────────────────────────────────────────────────────────

describe('options block', () => {
    it('serializes options with keys', () => {
        const root = ckRoot({ meta: { area: 'ledger' } });
        const result = astToCk(root);
        expect(result).toContain('options {');
        expect(result).toContain('    keys: {');
        expect(result).toContain('        area: ledger');
    });

    it('serializes options with services', () => {
        const root = ckRoot({
            services: { LedgerService: '#src/modules/ledger/ledger.service.js' },
        });
        const result = astToCk(root);
        expect(result).toContain('    services: {');
        expect(result).toContain('        LedgerService: "#src/modules/ledger/ledger.service.js"');
    });

    it('omits options block when empty', () => {
        const root = ckRoot();
        const result = astToCk(root);
        expect(result).not.toContain('options');
    });
});

// ─── Route Serialization ──────────────────────────────────────────────────

describe('route serialization', () => {
    it('serializes a simple GET route', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, refType('User'), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('operation /users: {');
        expect(result).toContain('    get: {');
        expect(result).toContain('        response: {');
        expect(result).toContain('            200: {');
        expect(result).toContain('                application/json: User');
    });

    it('serializes route with params', () => {
        const root = ckRoot({
            routes: [
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            responses: [opResponse(200, refType('User'), 'application/json')],
                        }),
                    ],
                    {
                        params: [opParam('id', scalarType('uuid'))],
                    },
                ),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('    params: {');
        expect(result).toContain('        id: uuid');
    });

    it('serializes route with query as type ref', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users', [
                    opOperation('get', {
                        query: 'Pagination',
                        responses: [opResponse(200, arrayType(refType('User')), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('        query: Pagination');
    });

    it('serializes request body', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest(refType('CreateUserInput')),
                        responses: [opResponse(201, refType('User'), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('        request: {');
        expect(result).toContain('            application/json: CreateUserInput');
    });

    it('serializes empty response (204)', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users/{id}', [
                    opOperation('delete', {
                        responses: [opResponse(204)],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('            204:');
    });

    it('serializes route with internal modifier', () => {
        const root = ckRoot({
            routes: [opRoute('/webhooks/stripe', [opOperation('post', { responses: [opResponse(204)] })], { modifiers: ['internal'] })],
        });
        const result = astToCk(root);
        expect(result).toContain('operation(internal) /webhooks/stripe: {');
    });

    it('serializes security: none', () => {
        const root = ckRoot({
            routes: [
                opRoute('/public', [
                    opOperation('get', {
                        security: 'none',
                        responses: [opResponse(200, refType('Data'), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('        security: none');
    });

    it('serializes security with roles', () => {
        const root = ckRoot({
            routes: [
                opRoute('/admin', [
                    opOperation('get', {
                        security: { roles: ['admin', 'superadmin'], loc: { file: 'test.ck', line: 1 } },
                        responses: [opResponse(200, refType('Data'), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('        security: {');
        expect(result).toContain('            roles: [admin, superadmin]');
    });

    it('serializes service and sdk fields', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users', [
                    opOperation('get', {
                        service: 'UserService.listUsers',
                        sdk: 'listUsers',
                        responses: [opResponse(200, arrayType(refType('User')), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('        service: UserService.listUsers');
        expect(result).toContain('        sdk: listUsers');
    });

    it('serializes multiple operations on one route', () => {
        const root = ckRoot({
            routes: [
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, arrayType(refType('User')), 'application/json')],
                    }),
                    opOperation('post', {
                        request: opRequest(refType('CreateUserInput')),
                        responses: [opResponse(201, refType('User'), 'application/json')],
                    }),
                ]),
            ],
        });
        const result = astToCk(root);
        expect(result).toContain('    get: {');
        expect(result).toContain('    post: {');
    });
});

// ─── Full Document ────────────────────────────────────────────────────────

describe('full document', () => {
    it('serializes a complete document with options, models, and routes', () => {
        const root = ckRoot({
            meta: { area: 'ledger' },
            services: { LedgerService: '#src/modules/ledger/ledger.service.js' },
            models: [
                model(
                    'LedgerAccount',
                    [
                        field('id', scalarType('uuid'), { visibility: 'readonly', description: 'The account ID' }),
                        field('name', scalarType('string', { min: 3, max: 100 })),
                    ],
                    { description: 'A ledger account' },
                ),
            ],
            routes: [
                opRoute('/ledger/accounts', [
                    opOperation('get', {
                        service: 'LedgerService.listAccounts',
                        responses: [opResponse(200, arrayType(refType('LedgerAccount')), 'application/json')],
                    }),
                ]),
            ],
        });

        const result = astToCk(root);

        // Options
        expect(result).toContain('options {');
        expect(result).toContain('area: ledger');
        expect(result).toContain('LedgerService: "#src/modules/ledger/ledger.service.js"');

        // Model
        expect(result).toContain('contract LedgerAccount: { # A ledger account');
        expect(result).toContain('    id: readonly uuid # The account ID');

        // Route
        expect(result).toContain('operation /ledger/accounts: {');
        expect(result).toContain('        service: LedgerService.listAccounts');
    });
});
