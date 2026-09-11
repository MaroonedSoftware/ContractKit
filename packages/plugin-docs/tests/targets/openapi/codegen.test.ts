import { describe, it, expect } from 'vitest';
import { parseDocument, type Scalar, type YAMLMap } from 'yaml';
import { parseCk, decomposeCk, applyOptionsDefaults, DiagnosticCollector } from '@contractkit/core';
import { generateOpenApi, buildOpenApiDocument, toYaml, scalarToSchema } from '../../../src/targets/openapi/codegen.js';
import {
    scalarType,
    arrayType,
    enumType,
    refType,
    unionType,
    discriminatedUnionType,
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
} from '../../helpers.js';

// ─── scalarToSchema ───────────────────────────────────────────────────────

describe('scalarToSchema', () => {
    it('maps time to string with format time', () => {
        expect(scalarToSchema({ kind: 'scalar', name: 'time' })).toEqual({ type: 'string', format: 'time' });
    });

    it('maps interval to string with format interval', () => {
        expect(scalarToSchema({ kind: 'scalar', name: 'interval' })).toEqual({ type: 'string', format: 'interval' });
    });

    it('maps decimal to a string, never a number', () => {
        // `type: number` would let a generator route the value through an IEEE-754 double, which
        // is the loss the scalar exists to prevent.
        expect(scalarToSchema({ kind: 'scalar', name: 'decimal' })).toEqual({
            type: 'string',
            format: 'decimal',
            pattern: '^-?\\d+(\\.\\d+)?$',
        });
    });

    it('narrows the decimal pattern by scale', () => {
        expect(scalarToSchema({ kind: 'scalar', name: 'decimal', scale: 2 })).toMatchObject({
            pattern: '^-?\\d+(\\.\\d{1,2})?$',
            'x-contractkit-scale': 2,
        });
    });

    it('carries exact decimal bounds in extensions, not in numeric minimum/maximum', () => {
        // JSON Schema's `minimum`/`maximum` are numeric and ignored on a string type, so the exact
        // values ride in extensions the importer can read back verbatim.
        const schema = scalarToSchema({ kind: 'scalar', name: 'decimal', min: '0.01', max: '999999.99' });
        expect(schema).toMatchObject({ 'x-contractkit-min': '0.01', 'x-contractkit-max': '999999.99' });
        expect(schema).not.toHaveProperty('minimum');
        expect(schema).not.toHaveProperty('maximum');
    });

    it('maps bigint to a digit string, never an integer', () => {
        // No ContractKit client sends a JSON number for a bigint and the server rejects one, so
        // `type: integer` described a request nothing generated from the spec could get accepted.
        expect(scalarToSchema({ kind: 'scalar', name: 'bigint' })).toEqual({
            type: 'string',
            format: 'bigint',
            pattern: '^-?\\d+n?$',
        });
    });

    it('documents a pattern that matches what every ContractKit client sends and nothing else', () => {
        // JSON Schema patterns are ECMA-262 regexes, unanchored unless the pattern anchors itself.
        const pattern = new RegExp(scalarToSchema({ kind: 'scalar', name: 'bigint' }).pattern as string, 'u');
        // The TypeScript SDK and server write "123n"; the Kotlin, Swift, C# and Python SDKs "123".
        for (const sent of ['123n', '123', '-9007199254740993', '-9007199254740993n', '0']) expect(pattern.test(sent)).toBe(true);
        for (const other of ['', 'n', '12.5', '1e3', '0x10', ' 123', '123 ', 'abc', '--1', '123nn']) expect(pattern.test(other)).toBe(false);
    });

    it('carries exact bigint bounds in extensions, beyond what a double could hold', () => {
        const schema = scalarToSchema({ kind: 'scalar', name: 'bigint', min: -9007199254740993n, max: 9007199254740993n });
        expect(schema).toMatchObject({ 'x-contractkit-min': '-9007199254740993', 'x-contractkit-max': '9007199254740993' });
        expect(schema).not.toHaveProperty('minimum');
        expect(schema).not.toHaveProperty('maximum');
    });

    it('throws on an unmapped scalar name', () => {
        expect(() => scalarToSchema({ kind: 'scalar', name: 'quaternion' } as any)).toThrow(/unmapped scalar 'quaternion'/);
    });
});

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

    it('quotes strings a YAML parser would read as a signed or dotted number', () => {
        // A negative bigint bound written bare came back from the parser as a rounded float.
        for (const s of ['-9007199254740993', '-0.10', '.5', '-.5', '.inf', '-.Inf', '.NaN']) {
            const yaml = toYaml({ value: s });
            expect(yaml).toBe(`value: '${s}'`);
            expect(parseDocument(yaml).get('value')).toBe(s);
        }
    });

    it('keeps strings that merely contain a dash or dot plain', () => {
        expect(toYaml('-abc')).toBe('-abc');
        expect(toYaml('.well-known')).toBe('.well-known');
        expect(toYaml('.information')).toBe('.information');
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

    it('keeps a multi-line string parseable and its line breaks intact', () => {
        // A description written over several lines in the contract. Single-quoted, the second line
        // landed at column 0 and the whole document failed to parse.
        const description = "How an entry reads.\nThere's deliberately no `waiting`:\n\ta station idling says so.";
        const yaml = toYaml({ components: { schemas: { Severity: { type: 'string', description } } } });
        const doc = parseDocument(yaml);
        expect(doc.errors).toEqual([]);
        expect(doc.getIn(['components', 'schemas', 'Severity', 'description'])).toBe(description);
    });

    it('keeps a multi-line string intact inside a block sequence', () => {
        const yaml = toYaml({ servers: [{ url: 'https://api.example.com', description: 'Production\r\nEU region' }] });
        const doc = parseDocument(yaml);
        expect(doc.errors).toEqual([]);
        expect(doc.getIn(['servers', 0, 'description'])).toBe('Production\r\nEU region');
    });

    it('writes an empty object value inline', () => {
        // `record(any)` becomes `additionalProperties: {}`. Emitted as a block, the `{}` landed at
        // column 0 on the next line and broke every mapping after it.
        const value = { type: 'object', additionalProperties: {}, description: 'after' };
        const yaml = toYaml({ properties: { detail: value } });
        expect(yaml).toContain('additionalProperties: {}');
        const doc = parseDocument(yaml);
        expect(doc.errors).toEqual([]);
        expect(doc.toJS()).toEqual({ properties: { detail: value } });
    });

    it('writes an empty object inline as the first key of a sequence item', () => {
        const value = [{ schema: {}, name: 'x' }];
        const doc = parseDocument(toYaml({ items: value }));
        expect(doc.errors).toEqual([]);
        expect(doc.toJS()).toEqual({ items: value });
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

// ─── buildOpenApiDocument ─────────────────────────────────────────────────

describe('buildOpenApiDocument', () => {
    const models = [model('User', [field('id', scalarType('string')), field('name', scalarType('string'))])];
    const roots = {
        contractRoots: [contractRoot(models)],
        opRoots: [opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, refType('User'))] })])])],
        config: { info: { title: 'My API', version: '2.0.0' } },
    };

    it('returns the document as an object rather than YAML', () => {
        const doc = buildOpenApiDocument(roots);
        expect(doc.openapi).toBe('3.1.0');
        expect(doc.info).toEqual({ title: 'My API', version: '2.0.0' });
    });

    it('exposes paths keyed by route and method', () => {
        const doc = buildOpenApiDocument(roots);
        const paths = doc.paths as Record<string, Record<string, unknown>>;
        expect(Object.keys(paths)).toEqual(['/users']);
        expect(paths['/users']).toHaveProperty('get');
    });

    it('exposes component schemas reachable from operations', () => {
        const doc = buildOpenApiDocument(roots);
        const components = doc.components as { schemas: Record<string, unknown> };
        expect(Object.keys(components.schemas)).toContain('User');
    });

    it('is what generateOpenApi serializes', () => {
        expect(generateOpenApi(roots)).toBe(toYaml(buildOpenApiDocument(roots)));
    });

    it('marks an operation public when its file states `security: none` in options', () => {
        // The file floor is the only declaration here; without it the operation fell back to the
        // global requirement and was documented as needing auth it does not ask for.
        const publicFile = { ...opRoot([opRoute('/health', [opOperation('get')])]), security: 'none' as const };
        const doc = buildOpenApiDocument({
            contractRoots: [],
            opRoots: [publicFile],
            config: { security: [{ bearerAuth: [] }] },
        });
        const paths = doc.paths as Record<string, Record<string, { security?: unknown }>>;
        expect(paths['/health']!.get!.security).toEqual([]);
    });
});

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

        it('writes a bigint default as a string, so the string schema accepts its own default', () => {
            const dto = contractRoot([model('Order', [field('quantity', scalarType('bigint'), { default: 5 })])]);
            const doc = buildOpenApiDocument({ contractRoots: [dto], opRoots: [], config: {} }) as {
                components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> };
            };
            expect(doc.components.schemas.Order!.properties.quantity).toMatchObject({ type: 'string', format: 'bigint', default: '5' });
        });

        it('writes an exact bigint default as a string, negative ones quoted', () => {
            const dto = contractRoot([
                model('Order', [
                    field('serial', scalarType('bigint'), { default: 9007199254740993n }),
                    field('floor', scalarType('bigint'), { default: -9007199254740993n }),
                ]),
            ]);
            const yaml = generateOpenApi({ contractRoots: [dto], opRoots: [], config: {} });
            const doc = parseDocument(yaml);
            expect(doc.getIn(['components', 'schemas', 'Order', 'properties', 'serial', 'default'])).toBe('9007199254740993');
            expect(doc.getIn(['components', 'schemas', 'Order', 'properties', 'floor', 'default'])).toBe('-9007199254740993');
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
            const dto = contractRoot([model('Admin', [field('role', enumType('admin', 'superadmin'))], { bases: ['User'] })]);
            const output = generateOpenApi({
                contractRoots: [dto],
                opRoots: [],
                config: {},
            });
            expect(output).toContain('allOf:');
            expect(output).toContain("'$ref': '#/components/schemas/User'");
        });

        it('emits one $ref per base for multi-base inheritance', () => {
            const dto = contractRoot([model('Test5', [field('e', scalarType('string'))], { bases: ['A', 'B', 'C', 'D'] })]);
            const output = generateOpenApi({ contractRoots: [dto], opRoots: [], config: {} });
            expect(output).toContain("'$ref': '#/components/schemas/A'");
            expect(output).toContain("'$ref': '#/components/schemas/B'");
            expect(output).toContain("'$ref': '#/components/schemas/C'");
            expect(output).toContain("'$ref': '#/components/schemas/D'");
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

        it('emits oneOf with a discriminator block for discriminated unions', () => {
            const card = model('Card', [field('kind', literalType('card')), field('last4', scalarType('string'))]);
            const bank = model('Bank', [field('kind', literalType('bank')), field('accountId', scalarType('string'))]);
            const method = model('PaymentMethod', [], { type: discriminatedUnionType('kind', refType('Card'), refType('Bank')) });
            const root = contractRoot([card, bank, method]);
            const op = opRoot([opRoute('/methods', [opOperation('get', { responses: [opResponse(200, 'PaymentMethod', 'application/json')] })])]);
            const output = generateOpenApi({
                contractRoots: [root],
                opRoots: [op],
                config: {},
            });
            expect(output).toContain('PaymentMethod:');
            expect(output).toContain('oneOf:');
            expect(output).toContain('discriminator:');
            expect(output).toContain('propertyName: kind');
            expect(output).toContain("card: '#/components/schemas/Card'");
            expect(output).toContain("bank: '#/components/schemas/Bank'");
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
            expect(output).toContain("'200':");
            expect(output).toContain("'application/json':");
            expect(output).toContain("'$ref': '#/components/schemas/User'");
        });

        it('emits every response key as a YAML string, not an integer', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json'), opResponse(404), opResponse(500)],
                    }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });

            // Parsed as a document rather than a plain object: JavaScript coerces every key to a
            // string, which would destroy the distinction. OpenAPI 3.x requires string keys, and a
            // bare `200:` is an integer to a YAML 1.2 parser.
            const doc = parseDocument(output);
            const responses = (doc.contents as YAMLMap).getIn(['paths', '/users', 'get', 'responses'], true);
            const keys = (responses as YAMLMap).items.map(i => (i.key as Scalar).value);
            expect(keys).toEqual(['200', '404', '500']);
            for (const key of keys) expect(typeof key).toBe('string');
        });

        it('gives a status one content entry per declared mime', () => {
            const op = opRoot([
                opRoute('/art', [
                    opOperation('get', {
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [
                                    { contentType: 'image/png', bodyType: { kind: 'scalar', name: 'binary' } },
                                    { contentType: 'image/jpeg', bodyType: { kind: 'scalar', name: 'binary' } },
                                ],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).toContain("'image/png':");
            expect(output).toContain("'image/jpeg':");
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
            expect(output).toContain("'204':");
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

        it('emits response headers', () => {
            const op = opRoot([
                opRoute('/transfers/{id}', [
                    opOperation('get', {
                        responses: [
                            {
                                statusCode: 200,
                                hasBlock: true,
                                bodies: [{ contentType: 'application/json', bodyType: refType('Transfer') }],
                                headers: [
                                    { name: 'preference-applied', optional: true, type: scalarType('string') },
                                    { name: 'etag', optional: false, type: scalarType('string'), description: 'cache validator' },
                                ],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
            expect(output).toContain('headers:');
            expect(output).toContain('preference-applied:');
            expect(output).toContain('etag:');
            expect(output).toContain("description: 'cache validator'");
            expect(output).toContain('required: true');
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

        it('includes internal operations when config.includeInternal is true', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', { responses: [opResponse(200)] }),
                    opOperation('post', { modifiers: ['internal'], responses: [opResponse(201)] }),
                ]),
            ]);
            const output = generateOpenApi({ contractRoots: [], opRoots: [op], config: { includeInternal: true } });
            expect(output).toContain('get:');
            expect(output).toContain('post:');
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

describe('options-level header globals', () => {
    function compileToOpenApi(source: string): string {
        const diag = new DiagnosticCollector();
        const ck = parseCk(source, 'widgets.ck', diag);
        applyOptionsDefaults(ck, diag);
        const { op } = decomposeCk(ck);
        return generateOpenApi({ contractRoots: [], opRoots: [op], config: {} });
    }

    it('renders global response headers on every status code, including bodyless and 4xx/5xx', () => {
        const output = compileToOpenApi(`
options { response: { headers: { x-request-id: uuid } } }
operation /widgets/{id}: {
    params: { id: uuid }
    delete: {
        response: {
            204:
            404:
            500: { application/json: ApiError }
        }
    }
}`);
        // Each of the three status code sections should declare x-request-id under headers:
        const matches = output.match(/x-request-id:/g) ?? [];
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });

    it('omits global response headers on a status code that opts out via headers: none', () => {
        const output = compileToOpenApi(`
options { response: { headers: { x-request-id: uuid } } }
operation /widgets: {
    get: {
        response: {
            200: { application/json: Widget }
            404: { headers: none }
        }
    }
}`);
        // Slice the document at the 404 marker — we expect no header for that response.
        const after404 = output.split(/^\s*'404':/m)[1] ?? '';
        const beforeNext = after404.split(/^\s*'\d{3}':/m)[0] ?? '';
        expect(beforeNext).not.toContain('x-request-id');
    });

    it('renders global request headers as parameters on every operation', () => {
        const output = compileToOpenApi(`
options { request: { headers: {
    x-request-id: uuid
    authorization: string
} } }
operation /widgets: {
    get: { response: { 200: { application/json: Widget } } }
    post: {
        request: { application/json: Widget }
        response: { 201: { application/json: Widget } }
    }
}`);
        // Both operations should carry the global headers as parameters.
        const requestIdParams = (output.match(/name: x-request-id\b/g) ?? []).length;
        const authParams = (output.match(/name: authorization\b/g) ?? []).length;
        expect(requestIdParams).toBe(2);
        expect(authParams).toBe(2);
        expect(output.match(/in: header/g)?.length).toBeGreaterThanOrEqual(4);
    });
});
