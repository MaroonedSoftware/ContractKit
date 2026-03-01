import { describe, it, expect } from 'vitest';
import { generateSdk, generateSdkOptions, generateSdkAggregator, deriveClientClassName, deriveClientPropertyName } from '../src/codegen-sdk.js';
import {
  opRoot, opRoute, opOperation, opParam, opRequest, opResponse,
  scalarType, refType, arrayType, inlineObjectType, field,
} from './helpers.js';

describe('generateSdk', () => {
  describe('sdk class naming', () => {
    it('derives sdk class name from filename', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ], 'users.op');
      const out = generateSdk(root);
      expect(out).toContain('export class UsersClient');
    });

    it('handles dotted filenames', () => {
      const root = opRoot([
        opRoute('/ledger/categories', [
          opOperation('get', { responses: [opResponse(200, 'Category', 'application/json')] }),
        ]),
      ], 'ledger.categories.op');
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
        opRoute('/users/:id', [
          opOperation('get', {
            responses: [opResponse(200, 'User', 'application/json')],
          }),
        ], [opParam('id', scalarType('uuid'))]),
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
        opRoute('/users/:id', [
          opOperation('get', {
            sdk: 'getUser',
            responses: [opResponse(200, 'User', 'application/json')],
          }),
        ], [opParam('id', scalarType('uuid'))]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('async getUser(id: string): Promise<User>');
      expect(out).toContain('encodeURIComponent(String(id))');
      expect(out).toContain("method: 'GET'");
      expect(out).toContain('return await res.json() as User');
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
      expect(out).toContain('JSON.stringify(body)');
    });
  });

  describe('DELETE with 204', () => {
    it('returns void for empty responses', () => {
      const root = opRoot([
        opRoute('/users/:id', [
          opOperation('delete', {
            sdk: 'deleteUser',
            responses: [opResponse(204)],
          }),
        ], [opParam('id', scalarType('uuid'))]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('async deleteUser(id: string): Promise<void>');
      // Should not contain res.json()
      expect(out).not.toMatch(/return await res\.json\(\)/);
    });
  });

  describe('query params', () => {
    it('adds query parameter to method signature', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            sdk: 'listUsers',
            query: [
              opParam('page', scalarType('int')),
              opParam('limit', scalarType('int')),
            ],
            responses: [opResponse(200, 'array(User)', 'application/json')],
          }),
        ]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('query?: { page?: number; limit?: number }');
      expect(out).toContain('URLSearchParams');
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
      expect(out).toContain('customHeaders?: { x-api-key?: string }');
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
            responses: [opResponse(200, inlineObjectType([
              field('data', arrayType(refType('User'))),
              field('total', scalarType('int')),
            ]), 'application/json')],
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
        opRoute('/users/:id', [
          opOperation('get', {
            sdk: 'getUser',
            responses: [opResponse(200, 'User', 'application/json')],
          }),
          opOperation('delete', {
            sdk: 'deleteUser',
            responses: [opResponse(204)],
          }),
        ], [opParam('id', scalarType('uuid'))]),
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
    it('emits SdkOptions interface with baseUrl, fetch, headers', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('export interface SdkOptions');
      expect(out).toContain('baseUrl: string');
      expect(out).toContain('fetch?: typeof fetch');
      expect(out).toContain('headers?:');
    });
  });

  describe('fetch helper', () => {
    it('emits private fetch method', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('private async fetch(');
      expect(out).toContain('this.options.baseUrl');
      expect(out).toContain("throw new Error(`HTTP ${res.status}");
    });
  });

  describe('SdkOptions import from shared file', () => {
    it('imports SdkOptions when sdkOptionsPath is provided', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const out = generateSdk(root, {
        outPath: '/sdk/src/users.client.ts',
        sdkOptionsPath: '/sdk/sdk-options.ts',
      });
      expect(out).toContain("import type { SdkOptions } from '../sdk-options.js'");
      expect(out).not.toContain('export interface SdkOptions');
    });

    it('emits inline SdkOptions when sdkOptionsPath not provided', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const out = generateSdk(root);
      expect(out).toContain('export interface SdkOptions');
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
  it('emits SdkOptions interface', () => {
    const out = generateSdkOptions();
    expect(out).toContain('export interface SdkOptions');
    expect(out).toContain('baseUrl: string');
    expect(out).toContain('fetch?: typeof fetch');
    expect(out).toContain('headers?:');
  });
});

describe('generateSdkAggregator', () => {
  it('generates Sdk class wrapping all clients', () => {
    const out = generateSdkAggregator([
      { className: 'UsersClient', propertyName: 'users', importPath: './src/users.client.js' },
      { className: 'CategoriesClient', propertyName: 'categories', importPath: './src/categories.client.js' },
    ]);
    expect(out).toContain("import type { SdkOptions } from './sdk-options.js'");
    expect(out).toContain("import { UsersClient } from './src/users.client.js'");
    expect(out).toContain("import { CategoriesClient } from './src/categories.client.js'");
    expect(out).toContain('export class Sdk {');
    expect(out).toContain('readonly users: UsersClient');
    expect(out).toContain('readonly categories: CategoriesClient');
    expect(out).toContain('constructor(options: SdkOptions)');
    expect(out).toContain('this.users = new UsersClient(options)');
    expect(out).toContain('this.categories = new CategoriesClient(options)');
  });

  it('uses custom sdkOptionsImportPath', () => {
    const out = generateSdkAggregator(
      [{ className: 'UsersClient', propertyName: 'users', importPath: './users.client.js' }],
      '../shared/sdk-options.js',
    );
    expect(out).toContain("from '../shared/sdk-options.js'");
  });
});
