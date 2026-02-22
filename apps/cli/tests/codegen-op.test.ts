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
          opOperation('get', { response: opResponse(200, 'User', 'application/json') }),
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
            response: opResponse(201, 'User', 'application/json'),
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
            response: opResponse(200, 'User', 'application/json'),
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
            response: opResponse(200, 'array(User)', 'application/json'),
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
            response: opResponse(201, 'User', 'application/json'),
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
            response: opResponse(200, 'array(User)', 'application/json'),
          }),
        ]),
      ]);
      const output = generateOp(root);
      // User should be in the type import
      expect(output).toMatch(/import.*User.*from/);
    });
  });

  // ─── Registration comment ─────────────────────────────────────

  describe('registration comment', () => {
    it('generates registration comment at end', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain('Register in');
      expect(output).toContain('.routes()');
    });
  });
});
