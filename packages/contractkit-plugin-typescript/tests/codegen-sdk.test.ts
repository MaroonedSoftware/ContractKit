import { describe, it, expect } from 'vitest';
import {
    generateSdk,
    generateSdkOptions,
    generateSdkAggregator,
    deriveClientClassName,
    deriveClientPropertyName,
    hasPublicOperations,
} from '../src/codegen-sdk.js';
import { collectPublicTypeNames } from '@contractkit/core';
import { renderTsType, renderInputTsType } from '../src/ts-render.js';
import {
    opRoot,
    opRoute,
    opOperation,
    opParam,
    opRequest,
    opResponse,
    scalarType,
    refType,
    arrayType,
    inlineObjectType,
    tupleType,
    recordType,
    enumType,
    literalType,
    lazyType,
    unionType,
    field,
} from './helpers.js';

describe('generateSdk', () => {
    describe('sdk class naming', () => {
        it('derives sdk class name from filename', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])], 'users.op');
            const out = generateSdk(root);
            expect(out).toContain('export class UsersClient');
        });

        it('handles dotted filenames', () => {
            const root = opRoot(
                [opRoute('/ledger/categories', [opOperation('get', { responses: [opResponse(200, 'Category', 'application/json')] })])],
                'ledger.categories.op',
            );
            const out = generateSdk(root);
            expect(out).toContain('export class LedgerCategoriesClient');
        });
    });

    describe('method names', () => {
        it('uses sdk field when provided', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listAllUsers',
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async listAllUsers(');
        });

        it('falls back to method + path inference', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async getUsers(');
        });

        it('includes path param segments in inferred name', () => {
            const root = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            responses: [opResponse(200, 'User', 'application/json')],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async getUsersById(');
        });

        it('infers POST method name', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async postUsers(');
        });
    });

    describe('GET with path params', () => {
        it('generates method with path params and correct return type', () => {
            const root = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            sdk: 'getUser',
                            responses: [opResponse(200, 'User', 'application/json')],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async getUser(id: string): Promise<User>');
            expect(out).toContain('encodeURIComponent(id)');
            expect(out).toContain("method: 'GET'");
            expect(out).toContain('return await parseJson<User>(result)');
        });
    });

    describe('POST with JSON body', () => {
        it('sends body with correct Content-Type', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        sdk: 'createUser',
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async createUser(body: CreateUserInput): Promise<User>');
            expect(out).toContain("'Content-Type': 'application/json'");
            expect(out).toContain('JSON.stringify(body, bigIntReplacer)');
        });
    });

    describe('DELETE with 204', () => {
        it('returns void for empty responses', () => {
            const root = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('delete', {
                            sdk: 'deleteUser',
                            responses: [opResponse(204)],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async deleteUser(id: string): Promise<void>');
            expect(out).not.toContain('await result.text()');
        });
    });

    describe('query params', () => {
        it('adds query parameter to method signature', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('query?: { page?: number; limit?: number }');
            expect(out).toContain('URLSearchParams');
        });

        it('appends qs directly to URL', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        query: [opParam('page', scalarType('int'))],
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('`/users${qs}`');
            expect(out).not.toContain('qs ? `/users');
        });

        it('buildQueryString returns ? prefix or empty string', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        query: [opParam('page', scalarType('int'))],
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain("return qs ? `?${qs}` : ''");
        });

        it('handles array query params with append instead of set', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        query: [opParam('status', arrayType(refType('Status'))), opParam('limit', scalarType('int'))],
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('Array.isArray(v)');
            expect(out).toContain('searchParams.append(k, String(item))');
        });

        it('handles type-ref query params', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        query: 'PaginationQuery',
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('query?: PaginationQuery');
        });
    });

    describe('headers', () => {
        it('adds custom headers parameter', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        headers: [opParam('x-api-key', scalarType('string'))],
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain("customHeaders?: { 'x-api-key'?: string }");
        });
    });

    describe('array response', () => {
        it('returns typed array', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        responses: [opResponse(200, arrayType(refType('User')), 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('Promise<User[]>');
        });
    });

    describe('inline object response', () => {
        it('renders inline TS type', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        responses: [
                            opResponse(
                                200,
                                inlineObjectType([field('data', arrayType(refType('User'))), field('total', scalarType('int'))]),
                                'application/json',
                            ),
                        ],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('Promise<{ data: User[]; total: number }>');
        });
    });

    describe('type imports', () => {
        it('generates type-only imports', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        sdk: 'createUser',
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('import type {');
            expect(out).toContain('CreateUserInput');
            expect(out).toContain('User');
        });

        it('uses modelOutPaths for relative imports', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'getUser',
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const out = generateSdk(root, {
                outPath: '/out/clients/users.sdk.ts',
                modelOutPaths: new Map([['User', '/out/types/user.ts']]),
            });
            expect(out).toContain("from '../types/user.js'");
        });
    });

    describe('multiple routes and operations', () => {
        it('generates all methods on one class', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        sdk: 'listUsers',
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                    opOperation('post', {
                        sdk: 'createUser',
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            sdk: 'getUser',
                            responses: [opResponse(200, 'User', 'application/json')],
                        }),
                        opOperation('delete', {
                            sdk: 'deleteUser',
                            responses: [opResponse(204)],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async listUsers(');
            expect(out).toContain('async createUser(');
            expect(out).toContain('async getUser(');
            expect(out).toContain('async deleteUser(');
            // All inside one class
            const classMatch = out.match(/export class \w+Client \{/g);
            expect(classMatch).toHaveLength(1);
        });
    });

    describe('SdkOptions interface', () => {
        it('emits SdkOptions interface with baseUrl, headers, fetch and SdkError', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root);
            expect(out).toContain('export interface SdkOptions');
            expect(out).toContain('baseUrl: string');
            expect(out).toContain('headers?:');
            expect(out).toContain('fetch?: SdkFetch');
            expect(out).toContain('export class SdkError extends Error');
        });
    });

    describe('requestIdFactory', () => {
        it('emits requestIdFactory on SdkOptions', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root);
            expect(out).toContain('requestIdFactory?: () => string');
        });

        it('does not add per-call options parameter to methods', () => {
            const root = opRoot([
                opRoute('/users', [
                    opOperation('get', { sdk: 'listUsers', responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('post', {
                        sdk: 'createUser',
                        request: opRequest('CreateUserInput'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
                opRoute(
                    '/users/{id}',
                    [opOperation('delete', { sdk: 'deleteUser', responses: [opResponse(204)] })],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const out = generateSdk(root);
            expect(out).toContain('async listUsers(): Promise');
            expect(out).toContain('async createUser(body: CreateUserInput): Promise');
            expect(out).toContain('async deleteUser(id: string): Promise');
            expect(out).not.toContain('SdkCallOptions');
        });

        it('defaults to crypto.randomUUID and injects X-Request-ID per request', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root);
            expect(out).toContain('requestIdFactory ?? (() => crypto.randomUUID())');
            expect(out).toContain("'X-Request-ID': getRequestId()");
        });
    });

    describe('fetch usage', () => {
        it('calls this.fetch in methods', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root);
            expect(out).toContain('this.fetch(');
            expect(out).toContain('constructor(private fetch: SdkFetch)');
        });
    });

    describe('SdkOptions import from shared file', () => {
        it('imports SdkOptions when sdkOptionsPath is provided', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root, {
                outPath: '/sdk/src/users.client.ts',
                sdkOptionsPath: '/sdk/sdk-options.ts',
            });
            expect(out).toContain("import type { SdkFetch } from '../sdk-options.js'");
            // GET-only: parseJson needed (response body), bigIntReplacer not needed (no request body), SdkError never used in client methods
            expect(out).toContain("import { parseJson } from '../sdk-options.js'");
            expect(out).not.toContain('bigIntReplacer');
            expect(out).not.toContain('SdkError');
            expect(out).not.toContain('export interface SdkOptions');
        });

        it('emits inline SdkOptions, SdkError, SdkFetch and createSdkFetch when sdkOptionsPath not provided', () => {
            const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
            const out = generateSdk(root);
            expect(out).toContain('export interface SdkOptions');
            expect(out).toContain('export class SdkError extends Error');
            expect(out).toContain('export type SdkFetch');
            expect(out).toContain('export function createSdkFetch(');
            expect(out).toContain('fetch?: SdkFetch');
        });
    });
});

describe('deriveClientClassName', () => {
    it('derives UsersClient from users.op', () => {
        expect(deriveClientClassName('users.op')).toBe('UsersClient');
    });

    it('handles dotted filenames', () => {
        expect(deriveClientClassName('ledger.categories.op')).toBe('LedgerCategoriesClient');
    });
});

describe('deriveClientPropertyName', () => {
    it('derives camelCase property name', () => {
        expect(deriveClientPropertyName('users.op')).toBe('users');
    });

    it('handles dotted filenames', () => {
        expect(deriveClientPropertyName('ledger.categories.op')).toBe('ledgerCategories');
    });
});

describe('generateSdkOptions', () => {
    it('emits SdkOptions interface, SdkError, SdkFetch and createSdkFetch', () => {
        const out = generateSdkOptions();
        expect(out).toContain('export interface SdkOptions');
        expect(out).toContain('baseUrl: string');
        expect(out).toContain('headers?:');
        expect(out).toContain('fetch?: SdkFetch');
        expect(out).toContain('requestIdFactory?: () => string');
        expect(out).toContain('export class SdkError extends Error');
        expect(out).toContain('public readonly status: number');
        expect(out).toContain('public readonly body: unknown');
        expect(out).toContain('throw new SdkError(');
        expect(out).toContain('export type SdkFetch');
        expect(out).toContain('export function createSdkFetch(options: SdkOptions): SdkFetch');
        expect(out).toContain('requestIdFactory ?? (() => crypto.randomUUID())');
        expect(out).toContain("'X-Request-ID': getRequestId()");
        // SecurityContext/securityHandler removed — auth is handled via headers option
        expect(out).not.toContain('SecurityContext');
        expect(out).not.toContain('securityHandler');
    });
});

describe('generateSdkAggregator', () => {
    it('generates Sdk class wrapping all clients', () => {
        const out = generateSdkAggregator([
            { className: 'UsersClient', propertyName: 'users', importPath: './src/users.client.js' },
            { className: 'CategoriesClient', propertyName: 'categories', importPath: './src/categories.client.js' },
        ]);
        expect(out).toContain("import type { SdkOptions } from './sdk-options.js'");
        expect(out).toContain("import { createSdkFetch } from './sdk-options.js'");
        expect(out).toContain("import { UsersClient } from './src/users.client.js'");
        expect(out).toContain("import { CategoriesClient } from './src/categories.client.js'");
        expect(out).toContain('export class Sdk {');
        expect(out).toContain('readonly users: UsersClient');
        expect(out).toContain('readonly categories: CategoriesClient');
        expect(out).toContain('constructor(options: SdkOptions)');
        expect(out).toContain('options.fetch ?? createSdkFetch(options)');
        expect(out).toContain('this.users = new UsersClient(sdkFetch)');
        expect(out).toContain('this.categories = new CategoriesClient(sdkFetch)');
    });

    it('uses custom sdkOptionsImportPath', () => {
        const out = generateSdkAggregator(
            [{ className: 'UsersClient', propertyName: 'users', importPath: './users.client.js' }],
            '../shared/sdk-options.js',
        );
        expect(out).toContain("from '../shared/sdk-options.js'");
    });
});

describe('generateSdk — route modifiers', () => {
    it('excludes internal operation from SDK output', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                opOperation('post', { modifiers: ['internal'], responses: [opResponse(201, 'User', 'application/json')] }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('getUsers('); // public GET is present
        expect(out).not.toContain('postUsers('); // internal POST is absent
    });

    it('excludes all operations when route is internal', () => {
        const root = opRoot([
            opRoute(
                '/admin/users',
                [
                    opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('delete', { responses: [opResponse(204)] }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        const out = generateSdk(root);
        expect(out).not.toContain('async getAdminUsers(');
        expect(out).not.toContain('async deleteAdminUsers(');
    });

    it('operation modifier overrides route-level internal — operation becomes visible', () => {
        const root = opRoot([
            opRoute(
                '/admin/users',
                [
                    opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('post', { responses: [opResponse(201, 'User', 'application/json')] }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        const out = generateSdk(root);
        // GET has explicit modifiers=['deprecated'] (overrides internal) → included
        expect(out).toContain('async getAdminUsers(');
        expect(out).toContain('/** @deprecated */');
        // POST inherits internal from route → excluded
        expect(out).not.toContain('async postAdminUsers(');
    });

    it('adds @deprecated jsdoc for deprecated operation', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200, 'User', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('/** @deprecated */');
    });

    it('uses op.name as method name when op.sdk is not set', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { name: 'Create an Offer', responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async createAnOffer(');
    });

    it('prefers op.sdk over op.name as method name', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { sdk: 'makeOffer', name: 'Create an Offer', responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async makeOffer(');
        expect(out).not.toContain('async createAnOffer(');
    });

    it('falls back to inferred method name when neither op.sdk nor op.name is set', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async postOffers(');
    });

    it('adds @name jsdoc tag when op.name is set', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { name: 'Create an Offer', responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('/** @name Create an Offer */');
    });

    it('emits multi-line jsdoc when both description and name are set', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { name: 'Create an Offer', description: 'Creates a new offer', responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('* @name Create an Offer');
        expect(out).toContain('* @description Creates a new offer');
    });

    it('emits single-line description jsdoc when only description is set', () => {
        const root = opRoot([
            opRoute('/offers', [opOperation('post', { description: 'Creates a new offer', responses: [opResponse(201, 'Offer', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('/** @description Creates a new offer */');
        expect(out).not.toContain('@name');
    });
});

describe('hasPublicOperations', () => {
    it('returns true when at least one operation is not internal', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                opOperation('post', { modifiers: ['internal'], responses: [opResponse(201, 'User', 'application/json')] }),
            ]),
        ]);
        expect(hasPublicOperations(root)).toBe(true);
    });

    it('returns false when all operations are internal via route modifier', () => {
        const root = opRoot([
            opRoute(
                '/admin/users',
                [
                    opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('post', { responses: [opResponse(201, 'User', 'application/json')] }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        expect(hasPublicOperations(root)).toBe(false);
    });

    it('returns false when all operations have explicit internal modifier', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { modifiers: ['internal'], responses: [opResponse(200, 'User', 'application/json')] })]),
        ]);
        expect(hasPublicOperations(root)).toBe(false);
    });

    it('returns true when an operation overrides route-level internal with empty modifiers', () => {
        const root = opRoot([
            opRoute('/admin/users', [opOperation('get', { modifiers: [], responses: [opResponse(200, 'User', 'application/json')] })], undefined, [
                'internal',
            ]),
        ]);
        expect(hasPublicOperations(root)).toBe(true);
    });

    it('does not include types from internal-only operations in SDK output', () => {
        const root = opRoot([
            opRoute('/admin/users', [opOperation('get', { modifiers: ['internal'], responses: [opResponse(200, 'AdminUser', 'application/json')] })]),
            opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('User');
        expect(out).not.toContain('AdminUser');
    });
});

describe('collectPublicTypeNames', () => {
    it('returns types from public ops only', () => {
        const root = opRoot([
            opRoute('/admin', [opOperation('get', { modifiers: ['internal'], responses: [opResponse(200, 'AdminReport', 'application/json')] })]),
            opRoute('/users', [
                opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                opOperation('post', { modifiers: ['internal'], responses: [opResponse(201, 'InternalAudit', 'application/json')] }),
            ]),
        ]);
        const types = collectPublicTypeNames(root);
        expect(types.has('User')).toBe(true);
        expect(types.has('AdminReport')).toBe(false);
        expect(types.has('InternalAudit')).toBe(false);
    });

    it('returns empty set when all ops are internal', () => {
        const root = opRoot([
            opRoute(
                '/admin',
                [opOperation('get', { modifiers: ['internal'], responses: [opResponse(200, 'AdminReport', 'application/json')] })],
                undefined,
                ['internal'],
            ),
        ]);
        const types = collectPublicTypeNames(root);
        expect(types.size).toBe(0);
    });
});

describe('generateSdk — route-level deprecated cascade', () => {
    it('adds @deprecated jsdoc when route is deprecated and operation has no modifiers', () => {
        const root = opRoot([
            opRoute(
                '/users',
                [
                    opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
                    opOperation('post', { responses: [opResponse(201, 'User', 'application/json')] }),
                ],
                undefined,
                ['deprecated'],
            ),
        ]);
        const out = generateSdk(root);
        // Both operations inherit deprecated from the route
        const deprecatedCount = (out.match(/\/\*\* @deprecated \*\//g) ?? []).length;
        expect(deprecatedCount).toBe(2);
    });

    it('operation-level modifiers override route-level deprecated', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { modifiers: [], responses: [opResponse(200, 'User', 'application/json')] })], undefined, [
                'deprecated',
            ]),
        ]);
        const out = generateSdk(root);
        // GET has explicit empty modifiers — overrides route deprecated → no jsdoc
        expect(out).not.toContain('/** @deprecated */');
    });
});

describe('generateSdk — json type', () => {
    it('emits JsonValue type declaration when response uses json scalar', () => {
        const root = opRoot([opRoute('/data', [opOperation('get', { responses: [opResponse(200, scalarType('json'), 'application/json')] })])]);
        const out = generateSdk(root);
        expect(out).toContain('export type JsonValue =');
        expect(out).toContain('async getData(');
        expect(out).toContain('Promise<JsonValue>');
    });

    it('emits JsonValue type declaration when request body uses json scalar', () => {
        const root = opRoot([
            opRoute('/data', [
                opOperation('post', {
                    request: { bodyType: scalarType('json'), contentType: 'application/json' },
                    responses: [opResponse(201)],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('export type JsonValue =');
        expect(out).toContain('body: JsonValue');
    });

    it('omits JsonValue type declaration when no json scalar used', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
        const out = generateSdk(root);
        expect(out).not.toContain('JsonValue');
    });
});

describe('hasPublicOperations — edge cases', () => {
    it('returns false for a root with no routes', () => {
        const root = opRoot([]);
        expect(hasPublicOperations(root)).toBe(false);
    });
});

// ─── renderTsType — type kind coverage ────────────────────────────────────

describe('renderTsType', () => {
    describe('scalar mappings', () => {
        it('maps email, url, uuid to string', () => {
            expect(renderTsType(scalarType('email'))).toBe('string');
            expect(renderTsType(scalarType('url'))).toBe('string');
            expect(renderTsType(scalarType('uuid'))).toBe('string');
        });

        it('maps date and datetime to string', () => {
            expect(renderTsType(scalarType('date'))).toBe('string');
            expect(renderTsType(scalarType('datetime'))).toBe('string');
        });

        it('maps bigint to bigint', () => {
            expect(renderTsType(scalarType('bigint'))).toBe('bigint');
        });

        it('maps null to null', () => {
            expect(renderTsType(scalarType('null'))).toBe('null');
        });

        it('maps unknown to unknown', () => {
            expect(renderTsType(scalarType('unknown'))).toBe('unknown');
        });

        it('maps object to Record<string, unknown>', () => {
            expect(renderTsType(scalarType('object'))).toBe('Record<string, unknown>');
        });

        it('maps binary to Blob', () => {
            expect(renderTsType(scalarType('binary'))).toBe('Blob');
        });

        it('maps json to JsonValue', () => {
            expect(renderTsType(scalarType('json'))).toBe('JsonValue');
        });
    });

    it('renders tuple type', () => {
        expect(renderTsType(tupleType(scalarType('string'), scalarType('int')))).toBe('[string, number]');
    });

    it('renders record type', () => {
        expect(renderTsType(recordType(scalarType('string'), refType('User')))).toBe('Record<string, User>');
    });

    it('renders inline enum type', () => {
        expect(renderTsType(enumType('active', 'inactive'))).toBe("'active' | 'inactive'");
    });

    it('wraps enum in parens when used as array item', () => {
        expect(renderTsType(arrayType(enumType('a', 'b')))).toBe("('a' | 'b')[]");
    });

    it('renders string literal type', () => {
        expect(renderTsType(literalType('draft'))).toBe("'draft'");
    });

    it('renders numeric literal type without quotes', () => {
        expect(renderTsType(literalType(42))).toBe('42');
    });

    it('renders intersection type', () => {
        expect(renderTsType({ kind: 'intersection', members: [refType('A'), refType('B')] })).toBe('A & B');
    });

    it('renders lazy type by unwrapping inner type', () => {
        expect(renderTsType(lazyType(refType('User')))).toBe('User');
    });

    it('renders inline object with optional field', () => {
        const type = inlineObjectType([field('id', scalarType('uuid')), field('name', scalarType('string'), { optional: true })]);
        expect(renderTsType(type)).toBe('{ id: string; name?: string }');
    });

    it('wraps union in parens when used as array item', () => {
        expect(renderTsType(arrayType(unionType(scalarType('string'), scalarType('null'))))).toBe('(string | null)[]');
    });

    it('wraps intersection in parens when used as array item', () => {
        expect(renderTsType(arrayType({ kind: 'intersection', members: [refType('A'), refType('B')] }))).toBe('(A & B)[]');
    });
});

// ─── renderInputTsType — modelsWithInput substitution ─────────────────────

describe('renderInputTsType', () => {
    const withInput = new Set(['User']);

    it('substitutes ref with Input variant when in modelsWithInput', () => {
        expect(renderInputTsType(refType('User'), withInput)).toBe('UserInput');
    });

    it('leaves ref unchanged when not in modelsWithInput', () => {
        expect(renderInputTsType(refType('Category'), withInput)).toBe('Category');
    });

    it('substitutes ref inside array', () => {
        expect(renderInputTsType(arrayType(refType('User')), withInput)).toBe('UserInput[]');
    });

    it('substitutes ref inside union', () => {
        expect(renderInputTsType(unionType(refType('User'), scalarType('null')), withInput)).toBe('UserInput | null');
    });

    it('substitutes ref inside intersection', () => {
        expect(renderInputTsType({ kind: 'intersection', members: [refType('User'), refType('Extra')] }, withInput)).toBe('UserInput & Extra');
    });

    it('substitutes ref inside inlineObject field', () => {
        const type = inlineObjectType([field('user', refType('User'))]);
        expect(renderInputTsType(type, withInput)).toBe('{ user: UserInput }');
    });

    it('substitutes ref inside lazy', () => {
        expect(renderInputTsType(lazyType(refType('User')), withInput)).toBe('UserInput');
    });

    it('falls back to renderTsType when modelsWithInput is empty', () => {
        expect(renderInputTsType(refType('User'), new Set())).toBe('User');
    });

    it('falls back to renderTsType when modelsWithInput is undefined', () => {
        expect(renderInputTsType(refType('User'), undefined)).toBe('User');
    });
});

// ─── buildMethodParams — ParamSource shapes ───────────────────────────────

describe('generateSdk — path param shapes', () => {
    it('handles string-typed route params (model ref)', () => {
        const root = opRoot([
            opRoute(
                '/things/{id}',
                [opOperation('get', { sdk: 'getThing', responses: [opResponse(200, 'Thing', 'application/json')] })],
                'ThingParams',
            ),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async getThing(params: ThingParams)');
    });

    it('substitutes Input variant for string-typed route params when in modelsWithInput', () => {
        const root = opRoot([
            opRoute(
                '/things/{id}',
                [opOperation('get', { sdk: 'getThing', responses: [opResponse(200, 'Thing', 'application/json')] })],
                'ThingParams',
            ),
        ]);
        const out = generateSdk(root, { modelsWithInput: new Set(['ThingParams']) });
        expect(out).toContain('params: ThingParamsInput');
    });

    it('handles ContractTypeNode-typed route params', () => {
        const root = opRoot([
            opRoute(
                '/things/{id}',
                [opOperation('get', { sdk: 'getThing', responses: [opResponse(200, 'Thing', 'application/json')] })],
                inlineObjectType([field('id', scalarType('uuid'))]),
            ),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async getThing(params: { id: string })');
    });
});

describe('generateSdk — headers shapes', () => {
    it('handles string-typed headers (model ref)', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', { sdk: 'listUsers', headers: 'AuthHeaders', responses: [opResponse(200, 'User', 'application/json')] }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('customHeaders?: AuthHeaders');
    });

    it('handles ContractTypeNode-typed headers', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', {
                    sdk: 'listUsers',
                    headers: inlineObjectType([field('authorization', scalarType('string'))]),
                    responses: [opResponse(200, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('customHeaders?: { authorization: string }');
    });

    it('handles ContractTypeNode-typed query', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', {
                    sdk: 'listUsers',
                    query: inlineObjectType([field('page', scalarType('int')), field('size', scalarType('int'))]),
                    responses: [opResponse(200, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('query?: { page: number; size: number }');
    });
});

describe('generateSdk — multipart/form-data', () => {
    it('uses FormData body type and omits Content-Type header', () => {
        const root = opRoot([
            opRoute('/uploads', [
                opOperation('post', {
                    sdk: 'upload',
                    request: opRequest(scalarType('string'), 'multipart/form-data'),
                    responses: [opResponse(201, 'Upload', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('async upload(body: FormData)');
        expect(out).toContain('body: body');
        expect(out).not.toContain("'Content-Type': 'application/json'");
        expect(out).not.toContain('JSON.stringify');
    });
});

// ─── generateMethod fetch assembly ────────────────────────────────────────

describe('generateSdk — fetch call assembly', () => {
    it('passes headers: customHeaders for GET with headers and no body', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('get', {
                    sdk: 'listUsers',
                    headers: [opParam('x-api-key', scalarType('string'))],
                    responses: [opResponse(200, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('headers: customHeaders');
        expect(out).not.toContain("'Content-Type': 'application/json'");
    });

    it('merges Content-Type and customHeaders for JSON body + headers', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'createUser',
                    request: opRequest('CreateUserInput'),
                    headers: [opParam('x-idempotency-key', scalarType('string'))],
                    responses: [opResponse(201, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain("'Content-Type': 'application/json', ...customHeaders");
        expect(out).toContain('JSON.stringify(body, bigIntReplacer)');
    });

    it('emits both URLSearchParams and JSON.stringify for query + body', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'searchUsers',
                    query: [opParam('page', scalarType('int'))],
                    request: opRequest('SearchInput'),
                    responses: [opResponse(200, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('URLSearchParams');
        expect(out).toContain('JSON.stringify(body, bigIntReplacer)');
    });
});

// ─── generateTypeImports ──────────────────────────────────────────────────

describe('generateSdk — type import paths', () => {
    it('uses default #modules/ path when no modelOutPaths or template', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { sdk: 'getUser', responses: [opResponse(200, 'User', 'application/json')] })])],
            'users.op',
        );
        const out = generateSdk(root);
        expect(out).toContain("from '#modules/users/types/index.js'");
    });

    it('substitutes {module} and {base} in typeImportPathTemplate', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { sdk: 'getUser', responses: [opResponse(200, 'User', 'application/json')] })])],
            'users.op',
        );
        const out = generateSdk(root, { typeImportPathTemplate: '@myapp/{module}/types' });
        expect(out).toContain("from '@myapp/users/types'");
    });

    it('splits types from different output files into separate import lines', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'createUser',
                    request: opRequest('CreateUserInput'),
                    responses: [opResponse(201, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root, {
            outPath: '/out/users.client.ts',
            modelOutPaths: new Map([
                ['User', '/out/types/user.ts'],
                ['CreateUserInput', '/out/types/create-user-input.ts'],
            ]),
        });
        expect(out).toContain("import type { User } from './types/user.js'");
        expect(out).toContain("import type { CreateUserInput } from './types/create-user-input.js'");
    });

    it('falls back to pascalToDotCase for types not in modelOutPaths', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    sdk: 'createUser',
                    request: opRequest('CreateUserInput'),
                    responses: [opResponse(201, 'User', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root, {
            outPath: '/out/users.client.ts',
            modelOutPaths: new Map([['User', '/out/types/user.ts']]),
        });
        expect(out).toContain("from './types/user.js'");
        expect(out).toContain("from './create.user.input.js'");
    });
});

// ─── generateSdkAggregator — additional cases ─────────────────────────────

describe('generateSdkAggregator — additional cases', () => {
    it('uses custom sdkClassName', () => {
        const out = generateSdkAggregator(
            [{ className: 'UsersClient', propertyName: 'users', importPath: './users.client.js' }],
            './sdk-options.js',
            'ApiClient',
        );
        expect(out).toContain('export class ApiClient {');
        expect(out).not.toContain('export class Sdk {');
    });

    it('handles empty clients array', () => {
        const out = generateSdkAggregator([]);
        expect(out).toContain('export class Sdk {');
        expect(out).toContain('constructor(options: SdkOptions)');
        expect(out).not.toContain('readonly ');
    });
});

// ─── collectPublicTypeNames — modelsWithInput ─────────────────────────────

describe('collectPublicTypeNames — modelsWithInput', () => {
    it('includes Input variant ref when model is in modelsWithInput and used in request body', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    request: opRequest('User'),
                    responses: [opResponse(201, 'User', 'application/json')],
                }),
            ]),
        ]);
        const types = collectPublicTypeNames(root, new Set(['User']));
        expect(types.has('UserInput')).toBe(true);
    });

    it('does not include Input variant when model is not in modelsWithInput', () => {
        const root = opRoot([
            opRoute('/users', [
                opOperation('post', {
                    request: opRequest('User'),
                    responses: [opResponse(201, 'User', 'application/json')],
                }),
            ]),
        ]);
        const types = collectPublicTypeNames(root, new Set());
        expect(types.has('UserInput')).toBe(false);
        expect(types.has('User')).toBe(true);
    });

    it('includes Input variant for string-typed route params', () => {
        const root = opRoot([
            opRoute('/things/{id}', [opOperation('get', { responses: [opResponse(200, 'Thing', 'application/json')] })], 'ThingParams'),
        ]);
        const types = collectPublicTypeNames(root, new Set(['ThingParams']));
        expect(types.has('ThingParamsInput')).toBe(true);
    });
});

// ─── sdkNeedsJson — query, headers, path params ───────────────────────────

describe('generateSdk — json type in query / headers / params', () => {
    it('emits JsonValue when json scalar used in query params', () => {
        const root = opRoot([
            opRoute('/search', [
                opOperation('get', {
                    query: [opParam('filter', scalarType('json'))],
                    responses: [opResponse(200, 'Result', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('export type JsonValue =');
    });

    it('emits JsonValue when json scalar used in headers', () => {
        const root = opRoot([
            opRoute('/data', [
                opOperation('get', {
                    headers: [opParam('x-context', scalarType('json'))],
                    responses: [opResponse(200, 'Result', 'application/json')],
                }),
            ]),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('export type JsonValue =');
    });

    it('emits JsonValue when json scalar used in path params', () => {
        const root = opRoot([
            opRoute(
                '/things/{meta}',
                [opOperation('get', { responses: [opResponse(200, 'Thing', 'application/json')] })],
                [opParam('meta', scalarType('json'))],
            ),
        ]);
        const out = generateSdk(root);
        expect(out).toContain('export type JsonValue =');
    });
});
