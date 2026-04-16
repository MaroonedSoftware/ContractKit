import { describe, it, expect } from 'vitest';
import { generateOpenApi, toYaml } from '../src/codegen-openapi.js';
import {
    scalarType,
    arrayType,
    enumType,
    refType,
    unionType,
    inlineObjectType,
    literalType,
    recordType,
    tupleType,
    field,
    model,
    contractRoot,
    opParam,
    opRequest,
    opResponse,
    opOperation,
    opRoute,
    opRoot,
} from './helpers.js';

// ─── YAML serializer ──────────────────────────────────────────────────────

describe('toYaml', () => {
    it('serializes simple scalars', () => {
        expect(toYaml('hello')).toBe('hello');
        expect(toYaml(42)).toBe('42');
        expect(toYaml(true)).toBe('true');
        expect(toYaml(null)).toBe('null');
    });

    it('quotes strings that look like YAML reserved words', () => {
        expect(toYaml('true')).toBe("'true'");
        expect(toYaml('null')).toBe("'null'");
        expect(toYaml('yes')).toBe("'yes'");
    });

    it('quotes empty strings', () => {
        expect(toYaml('')).toBe("''");
    });

    it('quotes strings starting with digits', () => {
        expect(toYaml('3.1.0')).toBe("'3.1.0'");
        expect(toYaml('0.0.1')).toBe("'0.0.1'");
    });

    it('serializes flat objects', () => {
        const result = toYaml({ name: 'test', count: 5 });
        expect(result).toContain('name: test');
        expect(result).toContain('count: 5');
    });

    it('serializes nested objects', () => {
        const result = toYaml({ info: { title: 'API', version: '1.0' } });
        expect(result).toContain('info:');
        expect(result).toContain('  title: API');
        expect(result).toContain("  version: '1.0'");
    });

    it('serializes simple arrays inline', () => {
        const result = toYaml({ required: ['id', 'name'] });
        expect(result).toContain('required: [id, name]');
    });

    it('serializes object arrays as block sequences', () => {
        const result = toYaml({
            servers: [{ url: 'https://api.example.com', description: 'Production' }],
        });
        expect(result).toContain('servers:');
        expect(result).toContain("- url: 'https://api.example.com'");
        expect(result).toContain('  description: Production');
    });
});

// ─── generateOpenApi ──────────────────────────────────────────────────────

describe('generateOpenApi', () => {
    // ─── Basic structure ─────────────────────────────────────────

    describe('document structure', () => {
        it('generates openapi 3.1.0 header', () => {
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [],
                config: {},
            });
            expect(output).toContain("openapi: '3.1.0'");
        });

        it('uses config info values', () => {
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [],
                config: {
                    info: { title: 'My API', version: '2.0.0', description: 'A test API' },
                },
            });
            expect(output).toContain("title: 'My API'");
            expect(output).toContain("version: '2.0.0'");
            expect(output).toContain("description: 'A test API'");
        });

        it('defaults title and version when not specified', () => {
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('title: API');
            expect(output).toContain("version: '0.0.1'");
        });

        it('includes servers when configured', () => {
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [],
                config: {
                    servers: [{ url: 'https://api.example.com', description: 'Prod' }],
                },
            });
            expect(output).toContain('servers:');
            expect(output).toContain("url: 'https://api.example.com'");
            expect(output).toContain('description: Prod');
        });

        it('includes security when configured', () => {
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [],
                config: {
                    security: [{ bearerAuth: [] }],
                },
                securitySchemes: {
                    bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
                },
            });
            expect(output).toContain('securitySchemes:');
            expect(output).toContain('bearerAuth:');
            expect(output).toContain('type: http');
            expect(output).toContain('scheme: bearer');
            expect(output).toContain('security:');
        });
    });

    // ─── Schema generation ──────────────────────────────────────

    describe('component schemas', () => {
        it('generates schema for simple model', () => {
            const dto = contractRoot([
                model('User', [
                    field('id', scalarType('uuid')),
                    field('name', scalarType('string', { min: 1, max: 100 })),
                    field('email', scalarType('email')),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('schemas:');
            expect(output).toContain('User:');
            expect(output).toContain('type: object');
            expect(output).toContain('format: uuid');
            expect(output).toContain('format: email');
            expect(output).toContain('minLength: 1');
            expect(output).toContain('maxLength: 100');
            expect(output).toContain('required: [id, name, email]');
        });

        it('handles optional fields by omitting from required', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid')), field('bio', scalarType('string'), { optional: true })])]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('required: [id]');
        });

        it('marks readonly/writeonly fields', () => {
            const dto = contractRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('password', scalarType('string'), { visibility: 'writeonly' }),
                    field('name', scalarType('string')),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('readOnly: true');
            expect(output).toContain('writeOnly: true');
        });

        it('handles default values', () => {
            const dto = contractRoot([
                model('Config', [field('active', scalarType('boolean'), { default: true }), field('pageSize', scalarType('int'), { default: 25 })]),
            ]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('default: true');
            expect(output).toContain('default: 25');
        });

        it('generates enum schema', () => {
            const dto = contractRoot([model('Status', [], { type: enumType('active', 'inactive', 'pending') })]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('type: string');
            expect(output).toContain('enum: [active, inactive, pending]');
        });

        it('generates array field schema', () => {
            const dto = contractRoot([model('Response', [field('items', arrayType(refType('Item')))])]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('type: array');
            expect(output).toContain("'$ref': '#/components/schemas/Item'");
        });

        it('generates model with base (allOf)', () => {
            const dto = contractRoot([model('Admin', [field('role', enumType('admin', 'superadmin'))], { base: 'User' })]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('allOf:');
            expect(output).toContain("'$ref': '#/components/schemas/User'");
        });

        it('handles scalar type constraints', () => {
            const dto = contractRoot([
                model('Pagination', [field('page', scalarType('int', { min: 0 })), field('pageSize', scalarType('int', { min: 1, max: 100 }))]),
            ]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('type: integer');
            expect(output).toContain('minimum: 0');
            expect(output).toContain('minimum: 1');
            expect(output).toContain('maximum: 100');
        });

        it('handles record type', () => {
            const dto = contractRoot([model('Metadata', [], { type: recordType(scalarType('string'), scalarType('string')) })]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('type: object');
            expect(output).toContain('additionalProperties:');
        });

        it('handles description on models and fields', () => {
            const dto = contractRoot([
                model('User', [field('name', scalarType('string'), { description: 'The user name' })], { description: 'A user object' }),
            ]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain("description: 'A user object'");
            expect(output).toContain("description: 'The user name'");
        });
    });

    // ─── Path generation ────────────────────────────────────────

    describe('paths', () => {
        it('converts :param to {param} in paths', () => {
            const op = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain("'/users/{id}':");
        });

        it('generates GET operation', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('get:');
            expect(output).toContain('200:');
            expect(output).toContain("'application/json':");
            expect(output).toContain("'$ref': '#/components/schemas/User'");
        });

        it('generates POST with request body', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('CreateUser'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('post:');
            expect(output).toContain('requestBody:');
            expect(output).toContain('required: true');
            expect(output).toContain("'$ref': '#/components/schemas/CreateUser'");
        });

        it('generates path parameters', () => {
            const op = opRoot([opRoute('/users/{userId}', [opOperation('get')], [opParam('userId', scalarType('uuid'))])]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('parameters:');
            expect(output).toContain('name: userId');
            expect(output).toContain('in: path');
            expect(output).toContain('format: uuid');
        });

        it('generates query parameters', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('name: page');
            expect(output).toContain('in: query');
            expect(output).toContain('name: limit');
        });

        it('generates header parameters', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        headers: [opParam('authorization', scalarType('string'))],
                    }),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('name: authorization');
            expect(output).toContain('in: header');
        });

        it('uses operationId from service binding', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.listUsers' })])]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('operationId: listUsers');
        });

        it('uses operationId from sdk name', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { sdk: 'getUsers' })])]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('operationId: getUsers');
        });

        it('generates 204 No content response', () => {
            const op = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('delete', {
                            responses: [opResponse(204)],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('204:');
            expect(output).toContain("description: 'No content'");
        });

        it('includes operation description', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { description: 'List all users' })])]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain("description: 'List all users'");
        });

        it('handles inline object response body', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [
                            opResponse(
                                200,
                                inlineObjectType([field('meta', refType('Pagination')), field('data', arrayType(refType('User')))]),
                                'application/json',
                            ),
                        ],
                    }),
                ]),
            ]);
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('type: object');
            expect(output).toContain('meta:');
            expect(output).toContain('data:');
        });
    });

    // ─── Multiple op files combined ─────────────────────────────

    describe('combining multiple files', () => {
        it('merges paths from multiple op files', () => {
            const op1 = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
            const op2 = opRoot([opRoute('/orders', [opOperation('get')])], 'orders.op');
            const output = generateOpenApi({
                contractRoots: [],
                opRoots: [op1, op2],
                config: {},
            });
            expect(output).toContain('/users');
            expect(output).toContain('/orders');
        });

        it('merges schemas from multiple contract files', () => {
            const dto1 = contractRoot([model('User', [field('id', scalarType('uuid'))])], 'user.ck');
            const dto2 = contractRoot([model('Order', [field('id', scalarType('uuid'))])], 'order.ck');
            const output = generateOpenApi({
                contractRoots: [dto1, dto2],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('User:');
            expect(output).toContain('Order:');
        });
    });
});

describe('route modifiers', () => {
    describe('internal', () => {
        it('excludes an internal operation from paths', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', { responses: [opResponse(200)] }),
                    opOperation('post', { modifiers: ['internal'], responses: [opResponse(201)] }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).toContain('get:');
            expect(output).not.toContain('post:');
        });

        it('excludes all operations when route is internal', () => {
            const op = opRoot([
                opRoute(
                    '/admin/users',
                    [opOperation('get', { responses: [opResponse(200)] }), opOperation('delete', { responses: [opResponse(204)] })],
                    undefined,
                    ['internal'],
                ),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).not.toContain('/admin/users');
        });

        it('operation-level override on internal route makes that operation visible', () => {
            const op = opRoot([
                opRoute(
                    '/admin/users',
                    [
                        opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200)] }),
                        opOperation('post', { responses: [opResponse(201)] }),
                    ],
                    undefined,
                    ['internal'],
                ),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).toContain('/admin/users');
            expect(output).toContain('get:');
            expect(output).not.toContain('post:');
        });
    });

    describe('schema filtering — internal operations', () => {
        it('excludes schemas only referenced by internal operations', () => {
            const dto = contractRoot([
                model('PublicModel', [field('id', scalarType('uuid'))]),
                model('InternalModel', [field('secret', scalarType('string'))]),
            ]);
            const op = opRoot([
                opRoute('/public', [opOperation('get', { responses: [opResponse(200, refType('PublicModel'))] })]),
                opRoute('/internal', [
                    opOperation('post', {
                        modifiers: ['internal'],
                        responses: [opResponse(201, refType('InternalModel'))],
                    }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [dto], opRoots: [op], config: {} });
            expect(output).toContain('PublicModel:');
            expect(output).not.toContain('InternalModel:');
        });

        it('transitively includes schemas referenced by public types', () => {
            const dto = contractRoot([
                model('Order', [field('item', refType('OrderItem'))]),
                model('OrderItem', [field('name', scalarType('string'))]),
                model('InternalData', [field('x', scalarType('string'))]),
            ]);
            const op = opRoot([
                opRoute('/orders', [opOperation('get', { responses: [opResponse(200, refType('Order'))] })]),
                opRoute('/admin', [
                    opOperation('get', {
                        modifiers: ['internal'],
                        responses: [opResponse(200, refType('InternalData'))],
                    }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [dto], opRoots: [op], config: {} });
            expect(output).toContain('Order:');
            expect(output).toContain('OrderItem:');
            expect(output).not.toContain('InternalData:');
        });

        it('excludes all schemas when all operations are internal', () => {
            const dto = contractRoot([model('Secret', [field('key', scalarType('string'))])]);
            const op = opRoot([
                opRoute(
                    '/admin',
                    [
                        opOperation('get', {
                            modifiers: ['internal'],
                            responses: [opResponse(200, refType('Secret'))],
                        }),
                    ],
                    undefined,
                    ['internal'],
                ),
            ]);
            const output = generateOpenApi({ contractRoots: [dto], opRoots: [op], config: {} });
            expect(output).not.toContain('Secret:');
            expect(output).not.toContain('schemas:');
        });

        it('includes all schemas when there are no op files', () => {
            const dto = contractRoot([model('Foo', [field('id', scalarType('uuid'))]), model('Bar', [field('name', scalarType('string'))])]);
            const output = generateOpenApi({ contractRoots: [dto], opRoots: [], config: {} });
            expect(output).toContain('Foo:');
            expect(output).toContain('Bar:');
        });
    });

    describe('deprecated', () => {
        it('sets deprecated: true for a deprecated operation', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200)] })])]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).toContain('deprecated: true');
        });

        it('does not set deprecated for a normal operation', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200)] })])]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).not.toContain('deprecated:');
        });

        it('cascades route-level deprecated to all operations', () => {
            const op = opRoot([
                opRoute(
                    '/users',
                    [opOperation('get', { responses: [opResponse(200)] }), opOperation('post', { responses: [opResponse(201)] })],
                    undefined,
                    ['deprecated'],
                ),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            const deprecatedCount = (output.match(/deprecated: true/g) ?? []).length;
            expect(deprecatedCount).toBe(2);
        });
    });
});
