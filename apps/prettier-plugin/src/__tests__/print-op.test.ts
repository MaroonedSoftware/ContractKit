import { describe, it, expect } from 'vitest';
import { printOp } from '../print-op.js';
import type { OpRootNode, OpRouteNode, OpOperationNode } from 'contract-dsl/src/ast.js';

// ─── Minimal AST builders ────────────────────────────────────────────────────

function makeLoc(line = 1) {
  return { file: 'test.op', line };
}

function makeOp(method: OpOperationNode['method'], overrides?: Partial<OpOperationNode>): OpOperationNode {
  return { method, responses: [], loc: makeLoc(), ...overrides };
}

function makeRoute(path: string, operations: OpOperationNode[], overrides?: Partial<OpRouteNode>): OpRouteNode {
  return { path, operations, loc: makeLoc(), ...overrides };
}

function makeRoot(routes: OpRouteNode[]): OpRootNode {
  return { kind: 'opRoot', meta: {}, routes, file: 'test.op' };
}

// ─── Route modifier printing ─────────────────────────────────────────────────

describe('printOp — route modifiers', () => {
  it('prints route with no modifiers (no colon before brace)', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get')]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/users {');
    expect(output).not.toMatch(/\/users\s*:/);
  });

  it('prints route with internal modifier', () => {
    const ast = makeRoot([
      makeRoute('/admin/users', [makeOp('get')], { modifiers: ['internal'] }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/admin/users: internal {');
  });

  it('prints route with deprecated modifier', () => {
    const ast = makeRoot([
      makeRoute('/v1/users', [makeOp('get')], { modifiers: ['deprecated'] }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/v1/users: deprecated {');
  });

  it('prints route with both internal and deprecated modifiers', () => {
    const ast = makeRoot([
      makeRoute('/legacy/users', [makeOp('get')], { modifiers: ['internal', 'deprecated'] }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/legacy/users: internal deprecated {');
  });

  it('treats empty modifiers array same as undefined (no colon)', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get')], { modifiers: [] }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/users {');
    expect(output).not.toMatch(/\/users\s*:/);
  });
});

// ─── Operation modifier printing ─────────────────────────────────────────────

describe('printOp — operation modifiers', () => {
  it('prints operation with no modifiers (no space between colon and brace)', () => {
    const ast = makeRoot([makeRoute('/users', [makeOp('get')])]);
    const output = printOp(ast);
    expect(output).toContain('    get: {');
  });

  it('prints operation with internal modifier', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', { modifiers: ['internal'] })]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    get: internal {');
  });

  it('prints operation with deprecated modifier', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', { modifiers: ['deprecated'] })]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    get: deprecated {');
  });

  it('prints operation with both internal and deprecated modifiers', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('post', { modifiers: ['internal', 'deprecated'] })]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    post: internal deprecated {');
  });

  it('treats empty operation modifiers array as no modifiers', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('delete', { modifiers: [] })]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    delete: {');
  });

  it('prints multiple operations with mixed modifiers', () => {
    const ast = makeRoot([
      makeRoute('/users', [
        makeOp('get', { modifiers: ['deprecated'] }),
        makeOp('post', { modifiers: ['internal'] }),
        makeOp('delete'),
      ]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    get: deprecated {');
    expect(output).toContain('    post: internal {');
    expect(output).toContain('    delete: {');
  });
});

// ─── Route + operation modifier combinations ──────────────────────────────────

describe('printOp — route and operation modifiers combined', () => {
  it('prints both route and operation modifiers independently', () => {
    const ast = makeRoot([
      makeRoute('/admin/users', [
        makeOp('get', { modifiers: ['deprecated'] }),
        makeOp('post', { modifiers: ['internal'] }),
      ], { modifiers: ['internal'] }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/admin/users: internal {');
    expect(output).toContain('    get: deprecated {');
    expect(output).toContain('    post: internal {');
  });

  it('preserves description alongside modifiers on route', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get')], {
        modifiers: ['deprecated'],
        description: 'Old user list',
      }),
    ]);
    const output = printOp(ast);
    expect(output).toContain('/users: deprecated { # Old user list');
  });

  it('preserves description alongside modifiers on operation', () => {
    const ast = makeRoot([
      makeRoute('/users', [
        makeOp('get', { modifiers: ['internal'], description: 'Admin only' }),
      ]),
    ]);
    const output = printOp(ast);
    expect(output).toContain('    get: internal { # Admin only');
  });
});

// ─── Security printing ────────────────────────────────────────────────────────

describe('printOp — security', () => {
  it('prints operation-level security: none', () => {
    const ast = makeRoot([
      makeRoute('/health', [makeOp('get', { security: 'none' })]),
    ]);
    expect(printOp(ast)).toContain('        security: none');
  });

  it('prints operation-level security block with single scheme', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', { security: [{ name: 'bearerAuth', scopes: [] }] })]),
    ]);
    const out = printOp(ast);
    expect(out).toContain('        security: {');
    expect(out).toContain('            bearerAuth');
    expect(out).toContain('        }');
  });

  it('prints operation-level security with scopes', () => {
    const ast = makeRoot([
      makeRoute('/users', [
        makeOp('get', { security: [{ name: 'bearerAuth', scopes: ['read:users', 'write:users'] }] }),
      ]),
    ]);
    expect(printOp(ast)).toContain('            bearerAuth "read:users" "write:users"');
  });

  it('prints multiple security schemes as separate lines', () => {
    const ast = makeRoot([
      makeRoute('/users', [
        makeOp('get', { security: [
          { name: 'bearerAuth', scopes: ['read:users'] },
          { name: 'apiKey', scopes: [] },
        ] }),
      ]),
    ]);
    const out = printOp(ast);
    expect(out).toContain('            bearerAuth "read:users"');
    expect(out).toContain('            apiKey');
  });

  it('prints route-level security with shallower indentation', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get')], {
        security: [{ name: 'bearerAuth', scopes: [] }],
      }),
    ]);
    const out = printOp(ast);
    expect(out).toContain('    security: {');
    expect(out).toContain('        bearerAuth');
  });

  it('prints route-level security: none', () => {
    const ast = makeRoot([
      makeRoute('/public', [makeOp('get')], { security: 'none' }),
    ]);
    expect(printOp(ast)).toContain('    security: none');
  });

  it('prints route-level and operation-level security independently', () => {
    const ast = makeRoot([
      makeRoute('/users', [
        makeOp('get', { security: 'none' }),
        makeOp('post', { security: [{ name: 'adminAuth', scopes: [] }] }),
      ], { security: [{ name: 'bearerAuth', scopes: [] }] }),
    ]);
    const out = printOp(ast);
    expect(out).toContain('    security: {');      // route-level
    expect(out).toContain('        bearerAuth');
    expect(out).toContain('        security: none');  // op-level override
    expect(out).toContain('        security: {');     // op-level block
    expect(out).toContain('            adminAuth');
  });

  it('emits no security line when security is undefined', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get')]),
    ]);
    expect(printOp(ast)).not.toContain('security');
  });
});

// ─── Query / headers with descriptions ───────────────────────────────────────

describe('printOp — query and headers descriptions', () => {
  it('emits inline comment on query params that have descriptions', () => {
    const loc = makeLoc();
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', {
        query: [
          { name: 'page', type: { kind: 'scalar', name: 'int' }, description: 'Page number', loc },
          { name: 'limit', type: { kind: 'scalar', name: 'int' }, loc },
        ],
      })]),
    ]);
    const out = printOp(ast);
    expect(out).toContain('            page: int # Page number');
    expect(out).toContain('            limit: int');
    expect(out).not.toMatch(/limit: int #/);
  });

  it('emits inline comment on headers params that have descriptions', () => {
    const loc = makeLoc();
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', {
        headers: [
          { name: 'X-Request-Id', type: { kind: 'scalar', name: 'uuid' }, description: 'Idempotency key', loc },
        ],
      })]),
    ]);
    expect(printOp(ast)).toContain('            X-Request-Id: uuid # Idempotency key');
  });
});

// ─── Idempotency: output is valid and parseable structure ─────────────────────

describe('printOp — modifier output structure', () => {
  it('produces valid block structure with route modifiers', () => {
    const ast = makeRoot([
      makeRoute('/admin', [makeOp('get'), makeOp('post')], { modifiers: ['internal'] }),
    ]);
    const output = printOp(ast);
    const lines = output.split('\n');
    const routeLine = lines.find(l => l.includes('/admin'));
    expect(routeLine).toMatch(/^\/admin: internal \{/);
    expect(lines.some(l => l === '}')).toBe(true);
  });

  it('places modifier between method and opening brace on operations', () => {
    const ast = makeRoot([
      makeRoute('/users', [makeOp('get', { modifiers: ['deprecated'] })]),
    ]);
    const output = printOp(ast);
    // Should be "    get: deprecated {" not "    get: { deprecated"
    expect(output).toMatch(/^\s+get: deprecated \{/m);
    expect(output).not.toMatch(/get: \{.*deprecated/);
  });
});
