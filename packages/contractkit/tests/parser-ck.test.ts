import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import { resolveModifiers, resolveSecurity, SECURITY_NONE } from '../src/ast.js';
import type {
  ScalarTypeNode,
  ArrayTypeNode,
  TupleTypeNode,
  RecordTypeNode,
  EnumTypeNode,
  LiteralTypeNode,
  UnionTypeNode,
  IntersectionTypeNode,
  ModelRefTypeNode,
  InlineObjectTypeNode,
  LazyTypeNode,
} from '../src/ast.js';

function parse(source: string, file = 'test.ck') {
  const diag = new DiagnosticCollector();
  const root = parseCk(source, file, diag);
  return { root, diag };
}

// ─── Contracts ────────────────────────────────────────────────────────────────

describe('contracts', () => {
  describe('simple models', () => {
    it('parses a model with no fields', () => {
      const { root } = parse('contract Empty: {}');
      expect(root.models).toHaveLength(1);
      expect(root.models[0]!.name).toBe('Empty');
      expect(root.models[0]!.fields).toHaveLength(0);
    });

    it('parses a model with scalar fields', () => {
      const { root } = parse(`\
contract User: {
    name: string
    age: number
    active: boolean
}`);
      const fields = root.models[0]!.fields;
      expect(fields).toHaveLength(3);
      expect(fields[0]!.name).toBe('name');
      expect(fields[0]!.type).toMatchObject({ kind: 'scalar', name: 'string' });
      expect(fields[1]!.name).toBe('age');
      expect(fields[1]!.type).toMatchObject({ kind: 'scalar', name: 'number' });
      expect(fields[2]!.name).toBe('active');
      expect(fields[2]!.type).toMatchObject({ kind: 'scalar', name: 'boolean' });
    });

    it('parses multiple models', () => {
      const { root } = parse(`\
contract User: {
    name: string
}

contract Post: {
    title: string
}`);
      expect(root.models).toHaveLength(2);
      expect(root.models[0]!.name).toBe('User');
      expect(root.models[1]!.name).toBe('Post');
    });
  });

  // ─── Field modifiers ────────────────────────────────────────────

  describe('field modifiers', () => {
    it('parses optional fields', () => {
      const { root } = parse('contract M: { name?: string }');
      expect(root.models[0]!.fields[0]!.optional).toBe(true);
    });

    it('parses nullable fields via union with null', () => {
      const { root } = parse('contract M: { name: string | null }');
      const field = root.models[0]!.fields[0]!;
      expect(field.nullable).toBe(true);
      expect(field.type.kind).toBe('scalar');
      expect((field.type as ScalarTypeNode).name).toBe('string');
    });

    it('parses fields with default string value', () => {
      const { root } = parse('contract M: { role: string = "user" }');
      expect(root.models[0]!.fields[0]!.default).toBe('user');
    });

    it('parses fields with default number value', () => {
      const { root } = parse('contract M: { count: number = 0 }');
      expect(root.models[0]!.fields[0]!.default).toBe(0);
    });

    it('parses fields with default boolean value', () => {
      const { root } = parse('contract M: { active: boolean = true }');
      expect(root.models[0]!.fields[0]!.default).toBe(true);
    });

    it('parses fields with default identifier value', () => {
      const { root, diag } = parse('contract M: { status: string = active }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.fields[0]!.default).toBe('active');
    });

    it('parses fields with negative default value', () => {
      const { root, diag } = parse('contract M: { offset: int = -1 }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.fields[0]!.default).toBe(-1);
    });

    it('parses readonly visibility', () => {
      const { root } = parse('contract M: { id: readonly uuid }');
      const field = root.models[0]!.fields[0]!;
      expect(field.visibility).toBe('readonly');
      expect(field.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses writeonly visibility', () => {
      const { root } = parse('contract M: { password: writeonly string }');
      expect(root.models[0]!.fields[0]!.visibility).toBe('writeonly');
    });

    it('parses field descriptions from inline comments', () => {
      const { root } = parse('contract M: {\n    name: string # The user name\n}');
      expect(root.models[0]!.fields[0]!.description).toBe('The user name');
    });

    it('parses field descriptions from preceding comments', () => {
      const { root } = parse(`\
contract M: {
    first: string
    # The user name
    name: string
}`);
      expect(root.models[0]!.fields[1]!.description).toBe('The user name');
    });
  });

  // ─── Scalar types ────────────────────────────────────────────────

  describe('scalar types', () => {
    it('parses all scalar type names', () => {
      const scalars = [
        'string', 'number', 'int', 'bigint', 'boolean',
        'date', 'datetime', 'email', 'url', 'uuid',
        'unknown', 'null', 'object', 'binary',
      ];
      for (const name of scalars) {
        const { root } = parse(`contract M: { f: ${name} }`);
        expect(root.models[0]!.fields[0]!.type).toMatchObject({ kind: 'scalar', name });
      }
    });

    it('parses string with min/max', () => {
      const { root } = parse('contract M: { name: string(min=1, max=100) }');
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.min).toBe(1);
      expect(type.max).toBe(100);
    });

    it('parses string with length', () => {
      const { root } = parse('contract M: { code: string(len=6) }');
      expect((root.models[0]!.fields[0]!.type as ScalarTypeNode).len).toBe(6);
    });

    it('parses string with regex', () => {
      const { root } = parse('contract M: { code: string(regex=/[A-Z]+/) }');
      expect((root.models[0]!.fields[0]!.type as ScalarTypeNode).regex).toBe('[A-Z]+');
    });

    it('parses number with min/max', () => {
      const { root } = parse('contract M: { score: number(min=0, max=100) }');
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.min).toBe(0);
      expect(type.max).toBe(100);
    });

    it('parses negative and float values in type args', () => {
      const { root, diag } = parse('contract M: { temp: number(min=-273.15, max=100) }');
      expect(diag.hasErrors()).toBe(false);
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.min).toBe(-273.15);
      expect(type.max).toBe(100);
    });
  });

  // ─── Compound types ──────────────────────────────────────────────

  describe('compound types', () => {
    it('parses array type', () => {
      const { root } = parse('contract M: { tags: array(string) }');
      const type = root.models[0]!.fields[0]!.type as ArrayTypeNode;
      expect(type.kind).toBe('array');
      expect(type.item).toMatchObject({ kind: 'scalar', name: 'string' });
    });

    it('parses array with min/max', () => {
      const { root } = parse('contract M: { tags: array(string, min=1, max=10) }');
      const type = root.models[0]!.fields[0]!.type as ArrayTypeNode;
      expect(type.min).toBe(1);
      expect(type.max).toBe(10);
    });

    it('parses tuple type', () => {
      const { root } = parse('contract M: { coords: tuple(number, number) }');
      const type = root.models[0]!.fields[0]!.type as TupleTypeNode;
      expect(type.kind).toBe('tuple');
      expect(type.items).toHaveLength(2);
    });

    it('parses record type', () => {
      const { root } = parse('contract M: { meta: record(string, number) }');
      const type = root.models[0]!.fields[0]!.type as RecordTypeNode;
      expect(type.kind).toBe('record');
      expect(type.key).toMatchObject({ kind: 'scalar', name: 'string' });
      expect(type.value).toMatchObject({ kind: 'scalar', name: 'number' });
    });

    it('parses enum type', () => {
      const { root } = parse('contract M: { status: enum(active, inactive, pending) }');
      const type = root.models[0]!.fields[0]!.type as EnumTypeNode;
      expect(type.kind).toBe('enum');
      expect(type.values).toEqual(['active', 'inactive', 'pending']);
    });

    it('parses literal string type', () => {
      const { root } = parse('contract M: { kind: literal("user") }');
      const type = root.models[0]!.fields[0]!.type as LiteralTypeNode;
      expect(type.kind).toBe('literal');
      expect(type.value).toBe('user');
    });

    it('parses literal number type', () => {
      const { root } = parse('contract M: { code: literal(42) }');
      expect((root.models[0]!.fields[0]!.type as LiteralTypeNode).value).toBe(42);
    });

    it('parses literal boolean type', () => {
      const { root } = parse('contract M: { flag: literal(true) }');
      expect((root.models[0]!.fields[0]!.type as LiteralTypeNode).value).toBe(true);
    });

    it('parses union type', () => {
      const { root } = parse('contract M: { val: string | number }');
      const type = root.models[0]!.fields[0]!.type as UnionTypeNode;
      expect(type.kind).toBe('union');
      expect(type.members).toHaveLength(2);
    });

    it('parses intersection type', () => {
      const { root } = parse('contract M: { val: Pagination & Sortable }');
      const type = root.models[0]!.fields[0]!.type as IntersectionTypeNode;
      expect(type.kind).toBe('intersection');
      expect(type.members).toHaveLength(2);
      expect((type.members[0] as ModelRefTypeNode).name).toBe('Pagination');
      expect((type.members[1] as ModelRefTypeNode).name).toBe('Sortable');
    });

    it('intersection binds tighter than union', () => {
      const { root } = parse('contract M: { val: string | Pagination & Sortable }');
      const type = root.models[0]!.fields[0]!.type as UnionTypeNode;
      expect(type.kind).toBe('union');
      expect(type.members[0]!.kind).toBe('scalar');
      expect((type.members[1] as IntersectionTypeNode).kind).toBe('intersection');
    });

    it('parses model reference type', () => {
      const { root } = parse('contract M: { address: Address }');
      const type = root.models[0]!.fields[0]!.type as ModelRefTypeNode;
      expect(type.kind).toBe('ref');
      expect(type.name).toBe('Address');
    });

    it('parses lazy type', () => {
      const { root } = parse('contract M: { children: lazy(TreeNode) }');
      const type = root.models[0]!.fields[0]!.type as LazyTypeNode;
      expect(type.kind).toBe('lazy');
      expect(type.inner).toMatchObject({ kind: 'ref', name: 'TreeNode' });
    });
  });

  // ─── Inline objects ──────────────────────────────────────────────

  describe('inline objects', () => {
    it('parses inline brace object', () => {
      const { root } = parse('contract M: { meta: { key: string, value: number } }');
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.kind).toBe('inlineObject');
      expect(type.fields).toHaveLength(2);
      expect(type.fields[0]!.name).toBe('key');
      expect(type.fields[1]!.name).toBe('value');
    });

    it('parses nested brace objects', () => {
      const { root } = parse(`\
contract M: {
    address: {
        street: string
        city: string
    }
}`);
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.kind).toBe('inlineObject');
      expect(type.fields).toHaveLength(2);
    });

    it('parses optional fields in inline objects', () => {
      const { root, diag } = parse('contract M: { meta: { key?: string, value: number } }');
      expect(diag.hasErrors()).toBe(false);
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.fields[0]!.optional).toBe(true);
      expect(type.fields[1]!.optional).toBeFalsy();
    });

    it('parses visibility modifiers in inline objects', () => {
      const { root, diag } = parse('contract M: { creds: { token: readonly string, secret: writeonly string } }');
      expect(diag.hasErrors()).toBe(false);
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.fields[0]!.visibility).toBe('readonly');
      expect(type.fields[1]!.visibility).toBe('writeonly');
    });

    it('parses default values in inline object fields', () => {
      const { root, diag } = parse('contract M: { opts: { page: int = 0, active: boolean = true } }');
      expect(diag.hasErrors()).toBe(false);
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.fields[0]!.default).toBe(0);
      expect(type.fields[1]!.default).toBe(true);
    });

    it('parses moded inline object as field type', () => {
      const { root, diag } = parse('contract M: { extra: mode(loose) { key: string } }');
      expect(diag.hasErrors()).toBe(false);
      const type = root.models[0]!.fields[0]!.type as InlineObjectTypeNode;
      expect(type.mode).toBe('loose');
      expect(type.fields[0]!.name).toBe('key');
    });
  });

  // ─── Model inheritance ───────────────────────────────────────────

  describe('model inheritance', () => {
    it('parses model with base model', () => {
      const { root } = parse('contract Admin: User & { role: string }');
      expect(root.models[0]!.base).toBe('User');
      expect(root.models[0]!.name).toBe('Admin');
    });

    it('parses intersection with inline object as inheritance', () => {
      const { root } = parse('contract Query: Pagination & { status?: enum(pending, posted) }');
      expect(root.models[0]!.base).toBe('Pagination');
      expect(root.models[0]!.fields[0]!.name).toBe('status');
      expect(root.models[0]!.fields[0]!.optional).toBe(true);
    });
  });

  // ─── Type aliases ────────────────────────────────────────────────

  describe('type aliases', () => {
    it('parses type alias with scalar type', () => {
      const { root, diag } = parse('contract UserId: uuid');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
      expect(root.models[0]!.fields).toHaveLength(0);
    });

    it('parses type alias with array type', () => {
      const { root, diag } = parse('contract Tags: array(string)');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.type).toMatchObject({ kind: 'array', item: { kind: 'scalar', name: 'string' } });
    });

    it('parses type alias with union type', () => {
      const { root, diag } = parse('contract Id: uuid | string');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.type).toMatchObject({ kind: 'union' });
    });

    it('parses type alias with enum type', () => {
      const { root, diag } = parse('contract OfferStatus: enum(active, accepted, declined) # The status of the offer');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.description).toBe('The status of the offer');
    });
  });

  // ─── Contract modifiers ──────────────────────────────────────────

  describe('contract modifiers', () => {
    it('marks a contract as deprecated', () => {
      const { root, diag } = parse('contract deprecated User: { id: string }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.deprecated).toBe(true);
    });

    it('marks a field as deprecated', () => {
      const { root, diag } = parse('contract User: { id: string\n  legacyId: deprecated string }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.fields[0]!.deprecated).toBeUndefined();
      expect(root.models[0]!.fields[1]!.deprecated).toBe(true);
    });

    it('allows deprecated before visibility modifier on a field', () => {
      const { root, diag } = parse('contract User: { password: deprecated writeonly string }');
      expect(diag.hasErrors()).toBe(false);
      const field = root.models[0]!.fields[0]!;
      expect(field.deprecated).toBe(true);
      expect(field.visibility).toBe('writeonly');
    });

    it('allows deprecated after visibility modifier on a field', () => {
      const { root, diag } = parse('contract User: { password: writeonly deprecated string }');
      expect(diag.hasErrors()).toBe(false);
      const field = root.models[0]!.fields[0]!;
      expect(field.deprecated).toBe(true);
      expect(field.visibility).toBe('writeonly');
    });

    it('combines deprecated with other model modifiers', () => {
      const { root, diag } = parse('contract deprecated mode(strip) LegacyUser: { id: string }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.models[0]!.deprecated).toBe(true);
      expect(root.models[0]!.mode).toBe('strip');
    });

    it('parses format(input=camel) modifier', () => {
      const { root } = parse('contract format(input=camel) mode(loose) Webhook: { eventType: string }');
      expect(root.models[0]!.mode).toBe('loose');
      expect(root.models[0]!.inputCase).toBe('camel');
      expect(root.models[0]!.outputCase).toBeUndefined();
    });

    it('parses format(output=snake) modifier', () => {
      const { root } = parse('contract format(output=snake) Webhook: { eventType: string }');
      expect(root.models[0]!.inputCase).toBeUndefined();
      expect(root.models[0]!.outputCase).toBe('snake');
    });

    it('parses format(input=pascal, output=snake) modifier', () => {
      const { root } = parse('contract format(input=pascal, output=snake) Webhook: { eventType: string }');
      expect(root.models[0]!.inputCase).toBe('pascal');
      expect(root.models[0]!.outputCase).toBe('snake');
    });
  });

  // ─── Descriptions ────────────────────────────────────────────────

  describe('descriptions', () => {
    it('parses model description from preceding comment', () => {
      const { root } = parse('# Represents a user\ncontract User: { name: string }');
      expect(root.models[0]!.description).toBe('Represents a user');
    });

    it('parses model description from inline comment', () => {
      const { root } = parse('contract User: { # A user model\n  name: string\n}');
      expect(root.models[0]!.description).toBe('A user model');
    });

    it('inline model comment does not shift field descriptions', () => {
      const { root } = parse(`\
contract Pagination: { # Represents a pagination object
    page: int = 0 # The page number
    pageSize: int = 25 # The page size
    total: int # The total count
}`);
      expect(root.models[0]!.description).toBe('Represents a pagination object');
      expect(root.models[0]!.fields[0]!.description).toBe('The page number');
      expect(root.models[0]!.fields[1]!.description).toBe('The page size');
      expect(root.models[0]!.fields[2]!.description).toBe('The total count');
    });
  });

  // ─── Source locations ────────────────────────────────────────────

  describe('source locations', () => {
    it('records correct line numbers on models and fields', () => {
      const { root } = parse('contract User: {\n    name: string\n    age: number\n}');
      expect(root.models[0]!.loc.line).toBe(1);
      expect(root.models[0]!.fields[0]!.loc.line).toBe(2);
      expect(root.models[0]!.fields[1]!.loc.line).toBe(3);
    });

    it('records the correct file name', () => {
      const { root } = parse('contract M: { f: string }', 'myfile.ck');
      expect(root.file).toBe('myfile.ck');
      expect(root.models[0]!.loc.file).toBe('myfile.ck');
    });
  });

  // ─── Error recovery ──────────────────────────────────────────────

  describe('error recovery', () => {
    it('collects parse errors in diagnostics', () => {
      const { diag } = parse('contract M: { : string }');
      expect(diag.hasErrors()).toBe(true);
    });

    it('reports error on malformed input', () => {
      const { diag } = parse('contract Bad: { : string }\ncontract Good: { name: string }');
      expect(diag.hasErrors()).toBe(true);
    });
  });
});

// ─── Operations ───────────────────────────────────────────────────────────────

describe('operations', () => {
  // ─── Route paths ────────────────────────────────────────────────

  describe('route paths', () => {
    it('parses simple route path', () => {
      const { root } = parse('operation /users: { get: {} }');
      expect(root.routes[0]!.path).toBe('/users');
    });

    it('parses route with path parameter', () => {
      const { root } = parse('operation /users/{id}: { get: {} }');
      expect(root.routes[0]!.path).toBe('/users/{id}');
    });

    it('parses nested route path', () => {
      const { root } = parse('operation /api/v1/users: { get: {} }');
      expect(root.routes[0]!.path).toBe('/api/v1/users');
    });

    it('parses route with multiple path parameters', () => {
      const { root } = parse('operation /users/{userId}/posts/{postId}: { get: {} }');
      expect(root.routes[0]!.path).toBe('/users/{userId}/posts/{postId}');
    });

    it('errors on route not starting with slash', () => {
      const { diag } = parse('operation users: { get: {} }');
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Params block ───────────────────────────────────────────────

  describe('params block', () => {
    it('parses params with scalar types', () => {
      const { root } = parse(`\
operation /users/{id}: {
    params: {
        id: uuid
    }
    get: {}
}`);
      expect(root.routes[0]!.params).toMatchObject({ kind: 'params' });
      expect((root.routes[0]!.params as any).nodes).toHaveLength(1);
      expect((root.routes[0]!.params as any).nodes[0].name).toBe('id');
      expect((root.routes[0]!.params as any).nodes[0].type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses multiple params', () => {
      const { root } = parse(`\
operation /users/{id}/posts/{postId}: {
    params: {
        id: uuid
        postId: uuid
    }
    get: {}
}`);
      expect(root.routes[0]!.params).toMatchObject({ kind: 'params' });
      expect((root.routes[0]!.params as any).nodes).toHaveLength(2);
      expect((root.routes[0]!.params as any).nodes[0].name).toBe('id');
      expect((root.routes[0]!.params as any).nodes[1].name).toBe('postId');
    });

    it('parses params as type reference', () => {
      const { root } = parse('operation /users/{id}: { params: RouteParams\n  get: {} }');
      expect(root.routes[0]!.params).toMatchObject({ kind: 'ref', name: 'RouteParams' });
    });

    it('parses mode prefix on params block', () => {
      const { root, diag } = parse(`\
operation /users/{id}: {
    mode(strip) params: {
        id: uuid
    }
    get: {}
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.routes[0]!.paramsMode).toBe('strip');
      expect((root.routes[0]!.params as any).nodes).toHaveLength(1);
    });
  });

  // ─── HTTP methods ────────────────────────────────────────────────

  describe('HTTP methods', () => {
    it('parses GET', () => {
      expect(parse('operation /r: { get: {} }').root.routes[0]!.operations[0]!.method).toBe('get');
    });

    it('parses POST', () => {
      expect(parse('operation /r: { post: {} }').root.routes[0]!.operations[0]!.method).toBe('post');
    });

    it('parses PUT', () => {
      expect(parse('operation /r: { put: {} }').root.routes[0]!.operations[0]!.method).toBe('put');
    });

    it('parses PATCH', () => {
      expect(parse('operation /r: { patch: {} }').root.routes[0]!.operations[0]!.method).toBe('patch');
    });

    it('parses DELETE', () => {
      expect(parse('operation /r: { delete: {} }').root.routes[0]!.operations[0]!.method).toBe('delete');
    });

    it('parses operation with empty body', () => {
      const op = parse('operation /r: { delete: {} }').root.routes[0]!.operations[0]!;
      expect(op.request).toBeUndefined();
      expect(op.responses).toHaveLength(0);
    });

    it('parses multiple HTTP methods under one route', () => {
      const { root } = parse('operation /users: { get: {}\n  post: {} }');
      expect(root.routes[0]!.operations).toHaveLength(2);
      expect(root.routes[0]!.operations[0]!.method).toBe('get');
      expect(root.routes[0]!.operations[1]!.method).toBe('post');
    });

    it('parses multiple routes', () => {
      const { root } = parse('operation /users: { get: {} }\noperation /posts: { get: {} }');
      expect(root.routes).toHaveLength(2);
      expect(root.routes[0]!.path).toBe('/users');
      expect(root.routes[1]!.path).toBe('/posts');
    });
  });

  // ─── Request block ───────────────────────────────────────────────

  describe('request block', () => {
    it('parses JSON request with body type', () => {
      const { root } = parse(`\
operation /users: {
    post: {
        request: {
            application/json: CreateUserInput
        }
    }
}`);
      const req = root.routes[0]!.operations[0]!.request;
      expect(req!.contentType).toBe('application/json');
      expect(req!.bodyType).toEqual({ kind: 'ref', name: 'CreateUserInput' });
    });

    it('parses multipart request', () => {
      const { root } = parse(`\
operation /uploads: {
    post: {
        request: {
            multipart/form-data: UploadInput
        }
    }
}`);
      expect(root.routes[0]!.operations[0]!.request!.contentType).toBe('multipart/form-data');
    });
  });

  // ─── Response block ──────────────────────────────────────────────

  describe('response block', () => {
    it('parses response with status code and body type', () => {
      const { root } = parse(`\
operation /users: {
    get: {
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
      const responses = root.routes[0]!.operations[0]!.responses;
      expect(responses).toHaveLength(1);
      expect(responses[0]!.statusCode).toBe(200);
      expect(responses[0]!.contentType).toBe('application/json');
      expect(responses[0]!.bodyType).toEqual({ kind: 'array', item: { kind: 'ref', name: 'User' } });
    });

    it('parses response with no body', () => {
      const { root } = parse('operation /r: { delete: { response: { 204: } } }');
      const responses = root.routes[0]!.operations[0]!.responses;
      expect(responses[0]!.statusCode).toBe(204);
      expect(responses[0]!.bodyType).toBeUndefined();
    });

    it('parses multiple response status codes', () => {
      const { root, diag } = parse(`\
operation /users/{id}: {
    get: {
        response: {
            200: {
                application/json: User
            }
            404: {
                application/json: ErrorBody
            }
            204:
        }
    }
}`);
      expect(diag.hasErrors()).toBe(false);
      const responses = root.routes[0]!.operations[0]!.responses;
      expect(responses).toHaveLength(3);
      expect(responses[0]!.statusCode).toBe(200);
      expect(responses[0]!.bodyType).toEqual({ kind: 'ref', name: 'User' });
      expect(responses[1]!.statusCode).toBe(404);
      expect(responses[1]!.bodyType).toEqual({ kind: 'ref', name: 'ErrorBody' });
      expect(responses[2]!.statusCode).toBe(204);
      expect(responses[2]!.bodyType).toBeUndefined();
    });
  });

  // ─── Query block ─────────────────────────────────────────────────

  describe('query block', () => {
    it('parses query with typed parameters', () => {
      const { root } = parse(`\
operation /users: {
    get: {
        query: {
            page: int
            limit: int
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.query).toMatchObject({ kind: 'params' });
      expect((op.query as any).nodes).toHaveLength(2);
      expect((op.query as any).nodes[0].name).toBe('page');
      expect((op.query as any).nodes[0].type).toMatchObject({ kind: 'scalar', name: 'int' });
    });

    it('parses query as type reference', () => {
      const { root } = parse('operation /users: { get: { query: Pagination } }');
      expect(root.routes[0]!.operations[0]!.query).toMatchObject({ kind: 'ref', name: 'Pagination' });
    });

    it('leaves query undefined when not declared', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.query).toBeUndefined();
    });

    it('parses mode prefix on query block', () => {
      const { root, diag } = parse(`\
operation /users: {
    get: {
        mode(strip) query: {
            page: int
        }
    }
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.routes[0]!.operations[0]!.queryMode).toBe('strip');
      expect((root.routes[0]!.operations[0]!.query as any).nodes).toHaveLength(1);
    });
  });

  // ─── Headers block ───────────────────────────────────────────────

  describe('headers block', () => {
    it('parses headers with typed parameters', () => {
      const { root } = parse(`\
operation /users: {
    get: {
        headers: {
            authorization: string
            x-request-id: uuid
        }
    }
}`);
      const op = root.routes[0]!.operations[0]!;
      expect(op.headers).toMatchObject({ kind: 'params' });
      expect((op.headers as any).nodes).toHaveLength(2);
      expect((op.headers as any).nodes[0].name).toBe('authorization');
      expect((op.headers as any).nodes[1].name).toBe('x-request-id');
    });

    it('parses headers as type reference', () => {
      const { root } = parse('operation /users: { get: { headers: CommonHeaders } }');
      expect(root.routes[0]!.operations[0]!.headers).toMatchObject({ kind: 'ref', name: 'CommonHeaders' });
    });

    it('leaves headers undefined when not declared', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.headers).toBeUndefined();
    });

    it('parses mode prefix on headers block', () => {
      const { root } = parse('operation /users: { get: { mode(strict) headers: { authorization: string } } }');
      expect(root.routes[0]!.operations[0]!.headersMode).toBe('strict');
    });

    it('parses strip mode on headers block', () => {
      const { root } = parse('operation /users: { get: { mode(strip) headers: { authorization: string } } }');
      expect(root.routes[0]!.operations[0]!.headersMode).toBe('strip');
    });

    it('defaults headersMode to undefined when no prefix', () => {
      const { root } = parse('operation /users: { get: { headers: { authorization: string } } }');
      expect(root.routes[0]!.operations[0]!.headersMode).toBeUndefined();
    });
  });

  // ─── Service declaration ─────────────────────────────────────────

  describe('service declaration', () => {
    it('parses service with class and method', () => {
      const { root } = parse('operation /users/{id}: { put: { service: LedgerService.updateUser } }');
      expect(root.routes[0]!.operations[0]!.service).toBe('LedgerService.updateUser');
    });

    it('parses service with class only', () => {
      const { root } = parse('operation /transfers: { post: { service: TransfersService } }');
      expect(root.routes[0]!.operations[0]!.service).toBe('TransfersService');
    });

    it('leaves service undefined when not declared', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.service).toBeUndefined();
    });
  });

  // ─── SDK declaration ─────────────────────────────────────────────

  describe('sdk declaration', () => {
    it('parses sdk method name', () => {
      const { root } = parse('operation /users: { get: { sdk: listUsers } }');
      expect(root.routes[0]!.operations[0]!.sdk).toBe('listUsers');
    });

    it('parses sdk alongside service', () => {
      const { root } = parse('operation /users/{id}: { get: { service: UserService.getById\n  sdk: getUser } }');
      expect(root.routes[0]!.operations[0]!.service).toBe('UserService.getById');
      expect(root.routes[0]!.operations[0]!.sdk).toBe('getUser');
    });

    it('leaves sdk undefined when not declared', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.sdk).toBeUndefined();
    });
  });

  // ─── Route modifiers ─────────────────────────────────────────────

  describe('route modifiers', () => {
    it('parses internal modifier on route', () => {
      expect(parse('operation(internal) /admin/users: { get: {} }').root.routes[0]!.modifiers).toEqual(['internal']);
    });

    it('parses deprecated modifier on route', () => {
      expect(parse('operation(deprecated) /old/users: { get: {} }').root.routes[0]!.modifiers).toEqual(['deprecated']);
    });

    it('route without modifier has undefined modifiers', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.modifiers).toBeUndefined();
    });

    it('parses internal modifier on operation', () => {
      expect(parse('operation /users: { post(internal): {} }').root.routes[0]!.operations[0]!.modifiers).toEqual(['internal']);
    });

    it('parses deprecated modifier on operation', () => {
      expect(parse('operation /users: { get(deprecated): {} }').root.routes[0]!.operations[0]!.modifiers).toEqual(['deprecated']);
    });

    it('operation without modifier has undefined modifiers', () => {
      expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.modifiers).toBeUndefined();
    });

    it('operation modifier overrides route modifier', () => {
      const { root } = parse('operation(internal) /admin: { get(deprecated): {} }');
      expect(root.routes[0]!.modifiers).toEqual(['internal']);
      expect(root.routes[0]!.operations[0]!.modifiers).toEqual(['deprecated']);
    });

    it('operation without modifier inherits route modifier via resolveModifiers', () => {
      const { root } = parse('operation(internal) /admin: { get: {}\n  post(deprecated): {} }');
      expect(root.routes[0]!.operations[0]!.modifiers).toBeUndefined();
      expect(root.routes[0]!.operations[1]!.modifiers).toEqual(['deprecated']);
    });

    it('public modifier on operation is stored in AST', () => {
      const { root } = parse('operation(internal) /admin: { get(public): {} }');
      expect(root.routes[0]!.operations[0]!.modifiers).toEqual(['public']);
    });

    it('public modifier strips inherited internal via resolveModifiers', () => {
      const { root } = parse('operation(internal) /admin: { get(public): {} }');
      expect(resolveModifiers(root.routes[0]!, root.routes[0]!.operations[0]!)).toEqual([]);
    });
  });

  // ─── Security ────────────────────────────────────────────────────

  describe('security', () => {
    it('parses security: none on operation', () => {
      expect(parse('operation /users: { get: { security: none } }').root.routes[0]!.operations[0]!.security).toBe(SECURITY_NONE);
    });

    it('parses security: none at route level', () => {
      const { root, diag } = parse('operation /public: { security: none\n  get: {} }');
      expect(diag.hasErrors()).toBe(false);
      expect(root.routes[0]!.security).toBe(SECURITY_NONE);
    });

    it('parses security: { roles: admin } with single role', () => {
      const { root } = parse('operation /users: { get: { security: { roles: admin } } }');
      expect((root.routes[0]!.operations[0]!.security as any).roles).toEqual(['admin']);
    });

    it('parses security: { roles: admin moderator editor } with multiple roles', () => {
      const { root } = parse('operation /users: { get: { security: { roles: admin moderator editor } } }');
      expect((root.routes[0]!.operations[0]!.security as any).roles).toEqual(['admin', 'moderator', 'editor']);
    });

    it('parses roles comment description in security block', () => {
      const { root, diag } = parse('operation /users: { get: { security: { roles: admin moderator # authorized roles\n} } }');
      expect(diag.hasErrors()).toBe(false);
      const sec = root.routes[0]!.operations[0]!.security as any;
      expect(sec.roles).toEqual(['admin', 'moderator']);
      expect(sec.rolesDescription).toBe('authorized roles');
    });

    it('parses SecuritySignatureLine inside security block', () => {
      const { root, diag } = parse('operation /hooks: { post: { security: { signature: "hmac-key"\n  roles: admin } } }');
      expect(diag.hasErrors()).toBe(false);
      expect((root.routes[0]!.operations[0]!.security as any).roles).toEqual(['admin']);
    });

    it('parses signature: "key" as operation-level field', () => {
      const { root } = parse('operation /users: { post: { signature: "hmac-sha256" } }');
      expect(root.routes[0]!.operations[0]!.signature).toBe('hmac-sha256');
    });

    it('parses signature: UNQUOTED_KEY', () => {
      const { root } = parse('operation /users: { post: { signature: MODERN_TREASURY_WEBHOOK } }');
      expect(root.routes[0]!.operations[0]!.signature).toBe('MODERN_TREASURY_WEBHOOK');
    });

    it('parses signature: alongside security: { roles }', () => {
      const { root } = parse('operation /users: { post: { signature: "hmac-sha256"\n  security: { roles: admin } } }');
      expect(root.routes[0]!.operations[0]!.signature).toBe('hmac-sha256');
      expect((root.routes[0]!.operations[0]!.security as any).roles).toEqual(['admin']);
    });

    it('parses route-level security: { roles: admin }', () => {
      const { root } = parse('operation /users: { security: { roles: admin }\n  get: {} }');
      expect((root.routes[0]!.security as any).roles).toEqual(['admin']);
    });

    it('resolveSecurity: op-level wins over route-level', () => {
      const { root } = parse('operation /users: { security: { roles: admin }\n  get: { security: none } }');
      expect(resolveSecurity(root.routes[0]!, root.routes[0]!.operations[0]!)).toBe(SECURITY_NONE);
    });

    it('resolveSecurity: falls back to route-level when op has no security', () => {
      const { root } = parse('operation /users: { security: { roles: admin }\n  get: {} }');
      expect((resolveSecurity(root.routes[0]!, root.routes[0]!.operations[0]!) as any).roles).toEqual(['admin']);
    });

    it('security: { ... } does not break subsequent fields', () => {
      const { root } = parse('operation /users: { get: { security: { roles: admin }\n  response: { 200: } } }');
      expect((root.routes[0]!.operations[0]!.security as any).roles).toEqual(['admin']);
      expect(root.routes[0]!.operations[0]!.responses[0]!.statusCode).toBe(200);
    });
  });

  // ─── Comment descriptions ────────────────────────────────────────

  describe('comment descriptions', () => {
    it('parses route description from preceding comment', () => {
      const { root } = parse('# User management routes\noperation /users: { get: {} }');
      expect(root.routes[0]!.description).toBe('User management routes');
    });

    it('parses operation description from preceding comment', () => {
      const { root } = parse('operation /users: { # List all users\n  get: {} }');
      expect(root.routes[0]!.operations[0]!.description).toBe('List all users');
    });

    it('parses operation description from inline comment after {', () => {
      const { root } = parse('operation /users: { post: { # Create a user\n  service: UserService.create } }');
      expect(root.routes[0]!.operations[0]!.description).toBe('Create a user');
    });

    it('returns undefined description when no comment present', () => {
      const { root } = parse('operation /users: { get: {} }');
      expect(root.routes[0]!.description).toBeUndefined();
      expect(root.routes[0]!.operations[0]!.description).toBeUndefined();
    });
  });

  // ─── Error recovery ──────────────────────────────────────────────

  describe('error recovery', () => {
    it('collects errors and continues parsing', () => {
      const { diag } = parse('operation bad-route-no-slash: { get: {} }');
      expect(diag.hasErrors()).toBe(true);
    });
  });
});

// ─── Options block ────────────────────────────────────────────────────────────

describe('options block', () => {
  it('parses keys section', () => {
    const { root } = parse('options {\n    keys: { area: ledger }\n}\ncontract User: { name: string }');
    expect(root.meta).toEqual({ area: 'ledger' });
    expect(root.models[0]!.name).toBe('User');
  });

  it('parses services section', () => {
    const { root } = parse('options {\n    services: { UserService: "#src/services/user.js" }\n}\ncontract User: { name: string }');
    expect(root.services).toEqual({ UserService: '#src/services/user.js' });
  });

  it('parses multiple keys entries', () => {
    const { root, diag } = parse(`\
options {
    keys: {
        area: billing
        module: payments
        version: v2
    }
}
contract Invoice: { total: number }`);
    expect(diag.hasErrors()).toBe(false);
    expect(root.meta).toEqual({ area: 'billing', module: 'payments', version: 'v2' });
  });

  it('parses quoted string values', () => {
    const { root } = parse(`\
options {
    keys: {
        area: "user-management"
        label: 'User Management'
    }
}
contract User: { name: string }`);
    expect(root.meta).toEqual({ area: 'user-management', label: 'User Management' });
  });

  it('parses unquoted hash-prefixed service path', () => {
    const { root } = parse(`\
options {
    services: {
        CapitalService: #modules/capital/capital.service.js
    }
}
operation /capital: { get: {} }`);
    expect(root.services).toEqual({ CapitalService: '#modules/capital/capital.service.js' });
  });

  it('parses multiple service entries', () => {
    const { root } = parse(`\
options {
    services: {
        CapitalService: #modules/capital/capital.service.js
        LedgerService: #modules/ledger/ledger.service.js
    }
}
operation /capital: { get: {} }`);
    expect(root.services).toEqual({
      CapitalService: '#modules/capital/capital.service.js',
      LedgerService: '#modules/ledger/ledger.service.js',
    });
  });

  it('parses security block in options', () => {
    const { root, diag } = parse(`\
options {
    security: {
        roles: admin
    }
}
operation /users: { get: {} }`);
    expect(diag.hasErrors()).toBe(false);
    expect((root.security as any).roles).toEqual(['admin']);
  });

  it('parses empty options block', () => {
    const { root, diag } = parse('options {}\ncontract User: { name: string }');
    expect(diag.hasErrors()).toBe(false);
    expect(root.meta).toEqual({});
    expect(root.services).toEqual({});
  });

  it('handles comments in options block', () => {
    const { root } = parse('options {\n    keys: {\n        # metadata\n        area: ledger\n    }\n}\ncontract User: { name: string }');
    expect(root.meta).toEqual({ area: 'ledger' });
  });

  it('defaults to empty meta when no options block', () => {
    expect(parse('contract User: { name: string }').root.meta).toEqual({});
    expect(parse('operation /users: { get: {} }').root.meta).toEqual({});
  });
});

// ─── Combined contracts and operations ───────────────────────────────────────

describe('combined contracts and operations', () => {
  it('parses contracts and operations in same file', () => {
    const { root } = parse(`\
contract User: {
    name: string
    email: email
}

operation /users: {
    get: {
        response: {
            200: {
                application/json: array(User)
            }
        }
    }
}`);
    expect(root.kind).toBe('ckRoot');
    expect(root.models).toHaveLength(1);
    expect(root.models[0]!.name).toBe('User');
    expect(root.routes).toHaveLength(1);
    expect(root.routes[0]!.path).toBe('/users');
  });

  it('parses multiple contracts and operations interleaved', () => {
    const { root } = parse(`\
contract Headers: {
    x-id: uuid
}

contract Body: {
    data: string
}

operation /webhook: {
    post: {
        headers: Headers
        request: {
            application/json: Body
        }
        response: {
            204:
        }
    }
}

operation /health: {
    get: {
        response: {
            200: {
                application/json: { status: string }
            }
        }
    }
}
`);
    expect(root.models.map(m => m.name)).toEqual(['Headers', 'Body']);
    expect(root.routes.map(r => r.path)).toEqual(['/webhook', '/health']);
  });
});

// ─── Test fixture ─────────────────────────────────────────────────────────────

describe('test.ck fixture', () => {
  it('parses the test.ck file without errors', () => {
    const source = readFileSync(resolve(__dirname, '../../../contracts/test.ck'), 'utf-8');
    const { root, diag } = parse(source, 'test.ck');

    expect(diag.hasErrors()).toBe(false);
    expect(root.kind).toBe('ckRoot');

    expect(root.meta).toEqual({ area: 'counterparty' });
    expect(root.services).toEqual({
      CounterpartyService: '#src/modules/counterparty/counterparty.service.js',
    });

    expect(root.models).toHaveLength(2);
    expect(root.models[0]!.name).toBe('ModernTreasuryWebhookHeaders');
    expect(root.models[0]!.fields).toHaveLength(6);
    expect(root.models[1]!.name).toBe('ModernTreasuryWebhookTransaction');
    expect(root.models[1]!.inputCase).toBe('camel');
    expect(root.models[1]!.mode).toBe('loose');

    expect(root.routes).toHaveLength(1);
    expect(root.routes[0]!.path).toBe('/webhooks/moderntreasury');
    expect(root.routes[0]!.modifiers).toEqual(['internal']);
    expect(root.routes[0]!.operations[0]!.method).toBe('post');
    expect(root.routes[0]!.operations[0]!.security).toBe('none');
  });
});
