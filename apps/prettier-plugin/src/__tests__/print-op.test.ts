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
