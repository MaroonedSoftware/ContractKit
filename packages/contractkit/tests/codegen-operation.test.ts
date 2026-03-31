import { describe, it, expect } from 'vitest';
import { generateOp } from '../src/codegen-operation.js';
import { SECURITY_NONE } from '../src/ast.js';
import { scalarType, arrayType, refType, inlineObjectType, field, opParam, opRequest, opResponse, opOperation, opRoute, opRoot } from './helpers.js';

describe('generateOperation', () => {
  // ─── Router name derivation ─────────────────────────────────────

  describe('router naming', () => {
    it('derives router name from file path', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
      const output = generateOp(root);
      expect(output).toContain('export const UsersRouter = ServerKitRouter();');
    });

    it('derives PascalCase name from dotted file', () => {
      const root = opRoot([opRoute('/categories', [opOperation('get')])], 'ledger.categories.op');
      const output = generateOp(root);
      expect(output).toContain('export const LedgerCategoriesRouter = ServerKitRouter();');
    });
  });

  // ─── Imports ───────────────────────────────────────────────────

  describe('imports', () => {
    it('generates zod import when inline params are used', () => {
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).toContain("import { z } from 'zod';");
    });

    it('omits zod import when no inline schemas are generated', () => {
      const root = opRoot([opRoute('/x', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).not.toContain("import { z } from 'zod';");
    });

    it('generates ServerKitRouter import', () => {
      const root = opRoot([opRoute('/x', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain('ServerKitRouter');
    });

    it('generates type imports when response references models', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
      const output = generateOp(root);
      expect(output).toContain('User');
    });

    it('generates parseAndValidate import when route has params', () => {
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('generates parseAndValidate import when route has request body', () => {
      const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate');
    });

    it('omits parseAndValidate when no validation needed', () => {
      const root = opRoot([opRoute('/health', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).not.toContain('parseAndValidate');
    });

    it('includes luxon DateTime import when query uses datetime type', () => {
      const root = opRoot([
        opRoute('/events', [
          opOperation('get', {
            query: [opParam('since', scalarType('datetime'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain("import { DateTime } from 'luxon';");
    });

    it('includes luxon DateTime import when inline param uses date type', () => {
      const root = opRoot([opRoute('/events/{date}', [opOperation('get')], [opParam('date', scalarType('date'))])]);
      const output = generateOp(root);
      expect(output).toContain("import { DateTime } from 'luxon';");
    });

    it('omits luxon DateTime import when no date/datetime types used', () => {
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).not.toContain('luxon');
    });
  });

  // ─── Handler generation — GET ──────────────────────────────────

  describe('GET handlers', () => {
    it('generates list service method for GET without path params', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain(".get('/users'");
      expect(output).toContain('service.list(');
    });

    it('generates getById service method for GET with path params', () => {
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).toContain('service.getById(');
    });
  });

  // ─── Handler generation — POST ─────────────────────────────────

  describe('POST handlers', () => {
    it('generates POST with body parser middleware', () => {
      const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
      const output = generateOp(root);
      expect(output).toContain("bodyParserMiddleware(['json'])");
    });

    it('generates body validation with parseAndValidate', () => {
      const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.body, CreateUser)');
    });

    it('generates create service method for POST', () => {
      const root = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
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
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(');
      expect(output).toContain('ctx.params');
      expect(output).toContain('z.strictObject({');
      expect(output).toContain('id: z.uuid()');
    });

    it('renders param types correctly', () => {
      const root = opRoot([opRoute('/items/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
      const output = generateOp(root);
      expect(output).toContain('id: z.uuid()');
    });

    it('generates type-reference params validation', () => {
      const root = opRoot([opRoute('/users/{id}', [opOperation('get')], 'RouteParams')]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.params, RouteParams.strict())');
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
      expect(output).toContain('page: z.coerce.number().int()');
      expect(output).toContain('limit: z.coerce.number().int()');
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
      const root = opRoot([opRoute('/users', [opOperation('get', { query: 'Pagination' })])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.query, Pagination.strict())');
    });

    it('imports type-reference query type', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { query: 'Pagination' })])]);
      const output = generateOp(root);
      expect(output).toMatch(/import.*Pagination.*from/);
    });

    it('wraps inline array query params with z.preprocess for single-value coercion', () => {
      const root = opRoot([
        opRoute('/offers', [
          opOperation('get', {
            query: [opParam('status', arrayType(refType('OfferStatus'))), opParam('limit', scalarType('int'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('z.preprocess');
      expect(output).toContain("typeof v === 'string' ? v.split(',') : v");
      // Non-array params should not be wrapped
      expect(output).toContain('limit: z.coerce.number().int()');
    });

    it('wraps DtoTypeNode intersection query with array fields using z.preprocess', () => {
      const root = opRoot([
        opRoute('/offers', [
          opOperation('get', {
            query: {
              kind: 'intersection',
              members: [
                { kind: 'ref', name: 'Pagination' },
                {
                  kind: 'inlineObject',
                  fields: [field('status', arrayType(refType('OfferStatus')), { optional: true })],
                },
              ],
            } as any,
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('Pagination.extend({');
      expect(output).toContain('z.preprocess');
      expect(output).toContain('.optional()');
    });
    it('coerces inline boolean query params with z.preprocess', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            query: [opParam('active', scalarType('boolean')), opParam('page', scalarType('int'))],
          }),
        ]),
      ]);
      const output = generateOp(root);
      // Boolean should use preprocess for string coercion
      expect(output).toContain("active: z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean())");
      // Int should still use z.coerce
      expect(output).toContain('page: z.coerce.number().int()');
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
      expect(output).toContain('z.object({');
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
      const root = opRoot([opRoute('/users', [opOperation('get', { headers: 'CommonHeaders' })])]);
      const output = generateOp(root);
      expect(output).toContain('parseAndValidate(ctx.headers, CommonHeaders.strip())');
    });

    it('uses strict mode for headers when specified', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            headers: [opParam('authorization', scalarType('string'))],
            headersMode: 'strict',
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('z.strictObject({');
    });

    it('uses strip mode for headers when specified', () => {
      const root = opRoot([
        opRoute('/users', [
          opOperation('get', {
            headers: [opParam('authorization', scalarType('string'))],
            headersMode: 'strip',
          }),
        ]),
      ]);
      const output = generateOp(root);
      expect(output).toContain('z.object({');
    });
  });

  // ─── Request handling ─────────────────────────────────────────

  describe('request handling', () => {
    it('handles multipart/form-data request', () => {
      const root = opRoot([opRoute('/uploads', [opOperation('post', { request: opRequest('Upload', 'multipart/form-data') })])]);
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
      const root = opRoot([opRoute('/users', [opOperation('post', { service: 'LedgerService.updateNesting' })])]);
      const output = generateOp(root);
      expect(output).toContain('service.updateNesting(');
      expect(output).toContain('LedgerService');
    });

    it('infers service from file name when not declared', () => {
      const root = opRoot([opRoute('/categories', [opOperation('get')])], 'ledger.categories.op');
      const output = generateOp(root);
      expect(output).toContain('LedgerCategoriesService');
    });

    it('uses meta for service import path when declared', () => {
      const root = opRoot([opRoute('/capital', [opOperation('post', { service: 'LedgerService.disburse' })])], 'capital.op', {
        LedgerService: '#modules/ledger/ledger.service.js',
      });
      const output = generateOp(root);
      expect(output).toContain("import { LedgerService } from '#modules/ledger/ledger.service.js';");
    });

    it('falls back to deriveModulePath when meta has no entry for service', () => {
      const root = opRoot([opRoute('/capital', [opOperation('get')])], 'capital.op', { SomeOtherService: '#other/path.js' });
      const output = generateOp(root);
      expect(output).toContain("import { CapitalService } from '#modules/capital/capital.service.js';");
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
      const root = opRoot([opRoute('/users', [opOperation('get', { loc: { file: 'users.op', line: 3 } })])], 'users.op');
      const output = generateOp(root);
      expect(output).toContain('file://./users.op#L3');
    });
  });

  // ─── JSDoc from descriptions ────────────────────────────────────

  describe('JSDoc from descriptions', () => {
    it('generates JSDoc comment from operation description', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { description: 'List all users' })])]);
      const output = generateOp(root);
      expect(output).toContain('* List all users');
    });

    it('falls back to route description when operation has none', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])]);
      root.routes[0]!.description = 'User routes';
      const output = generateOp(root);
      expect(output).toContain('* User routes');
    });

    it('includes source link JSDoc for all handlers', () => {
      const root = opRoot([opRoute('/users', [opOperation('get')])]);
      const output = generateOp(root);
      expect(output).toContain('/**');
      expect(output).toContain('file://');
    });
  });

  // ─── Configurable paths ──────────────────────────────────────

  describe('configurable paths', () => {
    it('uses custom service path template', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])]);
      const output = generateOp(root, {
        servicePathTemplate: '@services/{kebab}.service.js',
      });
      expect(output).toContain("from '@services/user.service.js'");
    });

    it('uses custom type import path template', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User', 'application/json')] })])]);
      const output = generateOp(root, {
        typeImportPathTemplate: '@types/{module}/index.js',
      });
      expect(output).toContain("from '@types/users/index.js'");
    });

    it('falls back to default paths when no template provided', () => {
      const root = opRoot([opRoute('/users', [opOperation('get', { service: 'UserService.list' })])]);
      const output = generateOp(root);
      expect(output).toContain("from '#modules/user/user.service.js'");
    });
  });
});

describe('generateOp — route modifiers JSDoc', () => {
  it('adds @internal to JSDoc for internal operation', () => {
    const root = opRoot([opRoute('/admin/users', [opOperation('get', { modifiers: ['internal'] })])]);
    const out = generateOp(root);
    expect(out).toContain('* @internal');
  });

  it('adds @deprecated to JSDoc for deprecated operation', () => {
    const root = opRoot([opRoute('/users', [opOperation('get', { modifiers: ['deprecated'] })])]);
    const out = generateOp(root);
    expect(out).toContain('* @deprecated');
  });

  it('inherits route-level internal modifier for JSDoc', () => {
    const root = opRoot([opRoute('/admin', [opOperation('get')], undefined, ['internal'])]);
    const out = generateOp(root);
    expect(out).toContain('* @internal');
  });

  it('operation modifier overrides route modifier in JSDoc', () => {
    const root = opRoot([opRoute('/admin', [opOperation('get', { modifiers: ['deprecated'] })], undefined, ['internal'])]);
    const out = generateOp(root);
    expect(out).toContain('* @deprecated');
    expect(out).not.toContain('* @internal');
  });

  it('still generates router handler for internal operations', () => {
    const root = opRoot([opRoute('/admin/users', [opOperation('get', { modifiers: ['internal'] })])]);
    const out = generateOp(root);
    // Handler is always generated (internal only affects SDK/docs)
    expect(out).toContain("UsersRouter.get('/admin/users'");
  });

  // ─── Security JSDoc ────────────────────────────────────────────

  describe('security JSDoc', () => {
    it('emits anonymous access, no security required for security: none', () => {
      const op = opOperation('get', { security: SECURITY_NONE });
      const root = opRoot([opRoute('/health', [op])]);
      const out = generateOp(root);
      expect(out).toContain('anonymous access, no security required');
    });

    it('emits no annotation for security with roles', () => {
      const op = opOperation('get', {
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
      });
      const root = opRoot([opRoute('/users', [op])]);
      const out = generateOp(root);
      expect(out).not.toContain('@authenticated');
    });

    it('emits no annotation for operation with signature', () => {
      const op = opOperation('post', {
        signature: 'hmac-sha256',
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/webhooks', [op])]);
      const out = generateOp(root);
      expect(out).not.toContain('@authenticated');
    });

    it('emits no annotation when security is not set', () => {
      const op = opOperation('get');
      const root = opRoot([opRoute('/users', [op])]);
      const out = generateOp(root);
      expect(out).not.toContain('anonymous access, no security required');
      expect(out).not.toContain('@authenticated');
    });
  });

  // ─── Signature middleware ───────────────────────────────────────

  describe('signature middleware', () => {
    it('injects requireSignature middleware and imports it when signature is set', () => {
      const op = opOperation('post', {
        signature: 'MODERN_TREASURY_WEBHOOK',
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/webhooks', [op])]);
      const out = generateOp(root);
      expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requireSecurity, requireSignature }`);
      expect(out).toContain(`requireSignature('MODERN_TREASURY_WEBHOOK')`);
    });

    it('places requireSignature after bodyParserMiddleware in the route line', () => {
      const op = opOperation('post', {
        signature: 'MY_KEY',
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/webhooks', [op])]);
      const routeLine = generateOp(root)
        .split('\n')
        .find(l => l.includes('.post('));
      expect(routeLine).toBeDefined();
      const sigIdx = routeLine!.indexOf(`requireSignature('MY_KEY')`);
      const bodyIdx = routeLine!.indexOf(`bodyParserMiddleware`);
      expect(sigIdx).toBeGreaterThan(-1);
      expect(sigIdx).toBeGreaterThan(bodyIdx);
    });

    it('does not import requireSignature when no signature is set', () => {
      const op = opOperation('get', {
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
      });
      const root = opRoot([opRoute('/users', [op])]);
      const out = generateOp(root);
      expect(out).not.toContain('requireSignature');
      expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requireSecurity }`);
    });
  });

  // ─── Security (roles) middleware ────────────────────────────────

  describe('security middleware', () => {
    it('injects requireSecurity() with no args for unannotated routes', () => {
      const op = opOperation('get');
      const root = opRoot([opRoute('/users', [op])]);
      const out = generateOp(root);
      expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requireSecurity }`);
      expect(out).toContain(`requireSecurity({  })`);
    });

    it('injects requireSecurity with roles when roles are set', () => {
      const op = opOperation('get', {
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
      });
      const root = opRoot([opRoute('/users', [op])]);
      const out = generateOp(root);
      expect(out).toContain(`requireSecurity({ roles: ['admin'] })`);
    });

    it('passes multiple roles as an array', () => {
      const op = opOperation('get', {
        security: { roles: ['admin', 'support'], loc: { file: 'test.op', line: 1 } },
      });
      const root = opRoot([opRoute('/users', [op])]);
      const routeLine = generateOp(root)
        .split('\n')
        .find(l => l.includes('.get('));
      expect(routeLine).toContain(`requireSecurity({ roles: ['admin', 'support'] })`);
    });

    it('does not inject requireSecurity for public (security: none) routes', () => {
      const op = opOperation('get', { security: SECURITY_NONE });
      const root = opRoot([opRoute('/health', [op])]);
      const out = generateOp(root);
      expect(out).not.toContain('requireSecurity');
    });

    it('does not import requireSecurity when all routes are public', () => {
      const op = opOperation('get', { security: SECURITY_NONE });
      const root = opRoot([opRoute('/health', [op])]);
      const out = generateOp(root);
      expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware }`);
      expect(out).not.toContain('requireSecurity');
    });

    it('places requireSecurity before bodyParserMiddleware in the route line', () => {
      const op = opOperation('post', {
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/users', [op])]);
      const routeLine = generateOp(root)
        .split('\n')
        .find(l => l.includes('.post('));
      expect(routeLine).toBeDefined();
      const secIdx = routeLine!.indexOf(`requireSecurity`);
      const bodyIdx = routeLine!.indexOf(`bodyParserMiddleware`);
      expect(secIdx).toBeGreaterThan(-1);
      expect(bodyIdx).toBeGreaterThan(secIdx);
    });

    it('places requireSecurity before requireSignature when both are set', () => {
      const op = opOperation('post', {
        signature: 'MY_KEY',
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/webhooks', [op])]);
      const routeLine = generateOp(root)
        .split('\n')
        .find(l => l.includes('.post('));
      expect(routeLine).toBeDefined();
      const secIdx = routeLine!.indexOf(`requireSecurity`);
      const sigIdx = routeLine!.indexOf(`requireSignature`);
      expect(secIdx).toBeGreaterThan(-1);
      expect(sigIdx).toBeGreaterThan(secIdx);
    });

    it('imports both requireSecurity and requireSignature when both are set', () => {
      const op = opOperation('post', {
        signature: 'MY_KEY',
        security: { roles: ['admin'], loc: { file: 'test.op', line: 1 } },
        request: opRequest('Payload'),
      });
      const root = opRoot([opRoute('/webhooks', [op])]);
      const out = generateOp(root);
      expect(out).toContain(`import { ServerKitRouter, bodyParserMiddleware, requireSecurity, requireSignature }`);
    });

    it('works with route-level roles security', () => {
      const op = opOperation('get');
      const route = opRoute('/users', [op]);
      route.security = { roles: ['admin'], loc: { file: 'test.op', line: 1 } };
      const root = opRoot([route]);
      const out = generateOp(root);
      expect(out).toContain(`requireSecurity({ roles: ['admin'] })`);
    });
  });
});
