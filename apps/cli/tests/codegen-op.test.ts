import { generateOp } from '../src/codegen-op.js';
import {
  scalarType, opParam, opRequest, opResponse,
  opOperation, opRoute, opRoot,
} from './helpers.js';

describe('generateOp', () => {
  // ─── Router name derivation ─────────────────────────────────────

  describe('router naming', () => {
    it('derives router name from file path', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get')]),
      ], 'users.op');
      const output = generateOp(root);
      expect(output).toContain('export const UsersRouter = ServerKitRouter();');
    });

    it('derives PascalCase name from dotted file', () => {
      const root = opRoot([
        opRoute('/categories', [opOperation('get')]),
      ], 'ledger.categories.op');
      const output = generateOp(root);
      expect(output).toContain('export const LedgerCategoriesRouter = ServerKitRouter();');
    });
  });

  // ─── Imports ───────────────────────────────────────────────────

  describe('imports', () => {
    it('generates zod import', () => {
      const root = opRoot([opRoute('/x', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain("import { z } from 'zod';");
    });

    it('generates ServerKitRouter import', () => {
      const root = opRoot([opRoute('/x', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain('ServerKitRouter');
    });

    it('generates type imports when response references models', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('User');
    });

    it('generates parseAndValidate import when route has params', () => {
      const root = opRoot([
        opRoute('/users/:id', [opOperation('get')], [opParam('id', scalarType('uuid'))]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('generates parseAndValidate import when route has request body', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', { request: opRequest('CreateUser') }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('omits parseAndValidate when no validation needed', () => {
      const root = opRoot([
        opRoute('/health', [opOperation('get')]),
      ]);
      const output = generateOp(root);
      expect(output).not.toContain('parseAndValidate');
    });
  });

  // ─── Handler generation — GET ──────────────────────────────────

  describe('GET handlers', () => {
    it('generates list service method for GET without path params', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get')]),
      ]);
      const output = generateOp(root);
      expect(output).toContain(".get('/users'");
      expect(output).toContain('service.list(');
    });

    it('generates getById service method for GET with path params', () => {
      const root = opRoot([
        opRoute('/users/:id', [opOperation('get')], [opParam('id', scalarType('uuid'))]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('service.getById(');
    });
  });

  // ─── Handler generation — POST ─────────────────────────────────

  describe('POST handlers', () => {
    it('generates POST with body parser middleware', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', { request: opRequest('CreateUser') }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain("bodyParserMiddleware(['json'])");
    });

    it('generates body validation with parseAndValidate', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', { request: opRequest('CreateUser') }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.body, CreateUser)');
    });

    it('generates create service method for POST', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', { request: opRequest('CreateUser') }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('service.create(');
    });
  });

  // ─── Handler generation — PUT/PATCH/DELETE ─────────────────────

  describe('PUT/PATCH/DELETE handlers', () => {
    it('generates replace for PUT', () => {
      const root = opRoot([opRoute('/users', [opOperation('put')])]);
      const output = generateOp(root);
      expect(output).toContain('service.replace(');
    });

    it('generates update for PATCH', () => {
      const root = opRoot([opRoute('/users', [opOperation('patch')])]);
      const output = generateOp(root);
      expect(output).toContain('service.update(');
    });

    it('generates delete for DELETE', () => {
      const root = opRoot([opRoute('/users', [opOperation('delete')])]);
      const output = generateOp(root);
      expect(output).toContain('service.delete(');
    });
  });

  // ─── Params validation ────────────────────────────────────────

  describe('params validation', () => {
    it('generates params validation block', () => {
      const root = opRoot([
        opRoute('/users/:id', [opOperation('get')], [opParam('id', scalarType('uuid'))]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(');
      expect(output).toContain('ctx.params');
      expect(output).toContain('z.strictObject({');
      expect(output).toContain('id: z.uuid()');
    });

    it('renders param types correctly', () => {
      const root = opRoot([
        opRoute('/items/:id', [opOperation('get')], [
          opParam('id', scalarType('uuid')),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('id: z.uuid()');
    });

    it('generates type-reference params validation', () => {
      const root = opRoot([
        opRoute('/users/:id', [opOperation('get')], 'RouteParams'),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.params, RouteParams)');
    });
  });

  // ─── Query validation ────────────────────────────────────────

  describe('query validation', () => {
    it('generates query validation block', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('ctx.query');
      expect(output).toContain('page: z.int()');
      expect(output).toContain('limit: z.int()');
    });

    it('generates parseAndValidate import when operation has query', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            query: [opParam('page', scalarType('int'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('generates type-reference query validation', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { query: 'Pagination' }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.query, Pagination)');
    });

    it('imports type-reference query type', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { query: 'Pagination' }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toMatch(/import.*Pagination.*from/);
    });
  });

  // ─── Headers validation ─────────────────────────────────────

  describe('headers validation', () => {
    it('generates headers validation block', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            headers: [opParam('authorization', scalarType('string'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('ctx.headers');
      expect(output).toContain('authorization: z.string()');
      expect(output).toContain('.passthrough()');
    });

    it('generates parseAndValidate import when operation has headers', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            headers: [opParam('authorization', scalarType('string'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('generates type-reference headers validation', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { headers: 'CommonHeaders' }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.headers, CommonHeaders)');
    });
  });

  // ─── Request handling ─────────────────────────────────────────

  describe('request handling', () => {
    it('handles multipart/form-data request', () => {
      const root = opRoot([
        opRoute('/uploads', [
          opOperation('post', { request: opRequest('Upload', 'multipart/form-data') }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain("bodyParserMiddleware(['multipart'])");
      expect(output).toContain('ctx.body as MultipartBody');
    });
  });

  // ─── Response ─────────────────────────────────────────────────

  describe('response', () => {
    it('sets status code from response', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', {
            request: opRequest('CreateUser'),
            responses: [opResponse(201, 'User', 'application/json')],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('ctx.status = 201');
    });

    it('sets application/json content type when response has body', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            responses: [opResponse(200, 'User', 'application/json')],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain("ctx.type = 'application/json'");
    });

    it('formats array response type annotation', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            responses: [opResponse(200, 'array(User)', 'application/json')],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('User[]');
    });

    it('defaults to status 200 when no response specified', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain('ctx.status = 200');
    });
  });

  // ─── Service inference ────────────────────────────────────────

  describe('service inference', () => {
    it('uses explicit service when declared', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', { service: 'LedgerService.updateNesting' }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('service.updateNesting(');
      expect(output).toContain('LedgerService');
    });

    it('infers service from file name when not declared', () => {
      const root = opRoot([
        opRoute('/categories', [opOperation('get')]),
      ], 'ledger.categories.op');
      const output = generateOp(root);
      expect(output).toContain('LedgerCategoriesService');
    });
  });

  // ─── Type collection ──────────────────────────────────────────

  describe('type collection', () => {
    it('collects PascalCase type names from body types', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('post', {
            request: opRequest('CreateUserInput'),
            responses: [opResponse(201, 'User', 'application/json')],
          }),
        ]),
      ]);
      const output = generateOp(root);
      // Both types should be imported
      expect(output).toContain('CreateUserInput');
      expect(output).toContain('User');
    });

    it('unwraps array() in body types for collection', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            responses: [opResponse(200, 'array(User)', 'application/json')],
          }),
        ]),
      ]);
      const output = generateOp(root);
      // User should be in the type import
      expect(output).toMatch(/import.*User.*from/);
    });
  });

  // ─── Source line comments ──────────────────────────────────────

  describe('source line comments', () => {
    it('includes source location in JSDoc above handler', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get', { loc: { file: 'users.op', line: 3 } })]),
      ], 'users.op');
      const output = generateOp(root);
      expect(output).toContain('file://users.op#L3');
    });
  });

  // ─── JSDoc from descriptions ────────────────────────────────────

  describe('JSDoc from descriptions', () => {
    it('generates JSDoc comment from operation description', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get', { description: 'List all users' })]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('* List all users');
    });

    it('falls back to route description when operation has none', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get')]),
      ]);
      root.routes[0]!.description = 'User routes';
      const output = generateOp(root);
      expect(output).toContain('* User routes');
    });

    it('includes source link JSDoc for all handlers', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get')]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('/**');
      expect(output).toContain('file://');
    });
  });

  // ─── Configurable paths ──────────────────────────────────────

  describe('configurable paths', () => {
    it('uses custom service path template', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get', { service: 'UserService.list' })]),
      ]);
      const output = generateOp(root, {
        servicePathTemplate: '@services/{kebab}.service.js',
      });
      expect(output).toContain("from '@services/user.service.js'");
    });

    it('uses custom type import path template', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] }),
        ]),
      ]);
      const output = generateOp(root, {
        typeImportPathTemplate: '@types/{module}/index.js',
      });
      expect(output).toContain("from '@types/users/index.js'");
    });

    it('falls back to default paths when no template provided', () => {
      const root = opRoot([
        opRoute('/users', [opOperation('get', { service: 'UserService.list' })]),
      ]);
      const output = generateOp(root);
      expect(output).toContain("from '#modules/user/user.service.js'");
    });
  });
});
