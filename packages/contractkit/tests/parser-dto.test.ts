import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
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

function parse(source: string) {
  const diag = new DiagnosticCollector();
  const ast = parseCk(source, 'test.ck', diag);
  return { root: ast, diag };
}

describe('parseDto', () => {
  // ─── Simple models ──────────────────────────────────────────────

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
      expect(root.models).toHaveLength(1);
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
      const { root } = parse(`\
contract M: {
    name?: string
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.optional).toBe(true);
    });

    it('parses nullable fields via union with null', () => {
      const { root } = parse(`\
contract M: {
    name: string | null
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.nullable).toBe(true);
      expect(field.type.kind).toBe('scalar');
      expect((field.type as ScalarTypeNode).name).toBe('string');
    });

    it('parses fields with default string value', () => {
      const { root } = parse(`\
contract M: {
    role: string = "user"
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.default).toBe('user');
    });

    it('parses fields with default number value', () => {
      const { root } = parse(`\
contract M: {
    count: number = 0
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.default).toBe(0);
    });

    it('parses fields with default boolean value', () => {
      const { root } = parse(`\
contract M: {
    active: boolean = true
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.default).toBe(true);
    });

    it('parses readonly visibility', () => {
      const { root } = parse(`\
contract M: {
    id: readonly uuid
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.visibility).toBe('readonly');
      expect(field.type).toMatchObject({ kind: 'scalar', name: 'uuid' });
    });

    it('parses writeonly visibility', () => {
      const { root } = parse(`\
contract M: {
    password: writeonly string
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.visibility).toBe('writeonly');
    });

    it('parses field descriptions from inline comments', () => {
      const { root } = parse(`\
contract M: {
    name: string # The user name
}`);
      const field = root.models[0]!.fields[0]!;
      expect(field.description).toBe('The user name');
    });

    it('parses field descriptions from preceding comments', () => {
      const { root } = parse(`\
contract M: {
    first: string
    # The user name
    name: string
}`);
      const field = root.models[0]!.fields[1]!;
      expect(field.description).toBe('The user name');
    });
  });

  // ─── Scalar types with modifiers ────────────────────────────────

  describe('scalar types with modifiers', () => {
    it('parses string with min/max', () => {
      const { root } = parse(`\
contract M: {
    name: string(min=1, max=100)
}`);
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.kind).toBe('scalar');
      expect(type.name).toBe('string');
      expect(type.min).toBe(1);
      expect(type.max).toBe(100);
    });

    it('parses string with length', () => {
      const { root } = parse(`\
contract M: {
    code: string(len=6)
}`);
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.len).toBe(6);
    });

    it('parses string with regex', () => {
      const { root } = parse(`\
contract M: {
    code: string(regex=/[A-Z]+/)
}`);
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.regex).toBe('[A-Z]+');
    });

    it('parses number with min/max', () => {
      const { root } = parse(`\
contract M: {
    score: number(min=0, max=100)
}`);
      const type = root.models[0]!.fields[0]!.type as ScalarTypeNode;
      expect(type.min).toBe(0);
      expect(type.max).toBe(100);
    });

    it('parses all scalar type names', () => {
      const scalars = [
        'string',
        'number',
        'int',
        'bigint',
        'boolean',
        'date',
        'datetime',
        'email',
        'url',
        'uuid',
        'unknown',
        'null',
        'object',
        'binary',
      ];
      for (const name of scalars) {
        const { root } = parse(`contract M: { f: ${name} }`);
        const type = root.models[0]!.fields[0]!.type;
        expect(type.kind).toBe('scalar');
        expect((type as ScalarTypeNode).name).toBe(name);
      }
    });
  });

  // ─── Compound types ─────────────────────────────────────────────

  describe('compound types', () => {
    it('parses array type', () => {
      const { root } = parse(`\
contract M: {
    tags: array(string)
}`);
      const type = root.models[0]!.fields[0]!.type as ArrayTypeNode;
      expect(type.kind).toBe('array');
      expect(type.item).toMatchObject({ kind: 'scalar', name: 'string' });
    });

    it('parses array with min/max', () => {
      const { root } = parse(`\
contract M: {
    tags: array(string, min=1, max=10)
}`);
      const type = root.models[0]!.fields[0]!.type as ArrayTypeNode;
      expect(type.min).toBe(1);
      expect(type.max).toBe(10);
    });

    it('parses tuple type', () => {
      const { root } = parse(`\
contract M: {
    coords: tuple(number, number)
}`);
      const type = root.models[0]!.fields[0]!.type as TupleTypeNode;
      expect(type.kind).toBe('tuple');
      expect(type.items).toHaveLength(2);
    });

    it('parses record type', () => {
      const { root } = parse(`\
contract M: {
    meta: record(string, number)
}`);
      const type = root.models[0]!.fields[0]!.type as RecordTypeNode;
      expect(type.kind).toBe('record');
      expect(type.key).toMatchObject({ kind: 'scalar', name: 'string' });
      expect(type.value).toMatchObject({ kind: 'scalar', name: 'number' });
    });

    it('parses enum type', () => {
      const { root } = parse(`\
contract M: {
    status: enum(active, inactive, pending)
}`);
      const type = root.models[0]!.fields[0]!.type as EnumTypeNode;
      expect(type.kind).toBe('enum');
      expect(type.values).toEqual(['active', 'inactive', 'pending']);
    });

    it('parses literal string type', () => {
      const { root } = parse(`\
contract M: {
    kind: literal("user")
}`);
      const type = root.models[0]!.fields[0]!.type as LiteralTypeNode;
      expect(type.kind).toBe('literal');
      expect(type.value).toBe('user');
    });

    it('parses literal number type', () => {
      const { root } = parse(`\
contract M: {
    code: literal(42)
}`);
      const type = root.models[0]!.fields[0]!.type as LiteralTypeNode;
      expect(type.value).toBe(42);
    });

    it('parses literal boolean type', () => {
      const { root } = parse(`\
contract M: {
    flag: literal(true)
}`);
      const type = root.models[0]!.fields[0]!.type as LiteralTypeNode;
      expect(type.value).toBe(true);
    });

    it('parses union type', () => {
      const { root } = parse(`\
contract M: {
    val: string | number
}`);
      const type = root.models[0]!.fields[0]!.type as UnionTypeNode;
      expect(type.kind).toBe('union');
      expect(type.members).toHaveLength(2);
    });

    it('parses intersection type', () => {
      const { root } = parse(`\
contract M: {
    val: Pagination & Sortable
}`);
      const type = root.models[0]!.fields[0]!.type as IntersectionTypeNode;
      expect(type.kind).toBe('intersection');
      expect(type.members).toHaveLength(2);
      expect((type.members[0] as ModelRefTypeNode).name).toBe('Pagination');
      expect((type.members[1] as ModelRefTypeNode).name).toBe('Sortable');
    });

    it('parses intersection with inline object as inheritance', () => {
      const { root } = parse(`\
contract Query: Pagination & {
    status?: enum(pending, posted)
}`);
      const m = root.models[0]!;
      expect(m.base).toBe('Pagination');
      expect(m.fields).toHaveLength(1);
      expect(m.fields[0]!.name).toBe('status');
      expect(m.fields[0]!.optional).toBe(true);
    });

    it('intersection binds tighter than union', () => {
      const { root } = parse(`\
contract M: {
    val: string | Pagination & Sortable
}`);
      const type = root.models[0]!.fields[0]!.type as UnionTypeNode;
      expect(type.kind).toBe('union');
      expect(type.members).toHaveLength(2);
      expect(type.members[0]!.kind).toBe('scalar');
      const inter = type.members[1] as IntersectionTypeNode;
      expect(inter.kind).toBe('intersection');
      expect(inter.members).toHaveLength(2);
    });

    it('parses model reference type', () => {
      const { root } = parse(`\
contract M: {
    address: Address
}`);
      const type = root.models[0]!.fields[0]!.type as ModelRefTypeNode;
      expect(type.kind).toBe('ref');
      expect(type.name).toBe('Address');
    });

    it('parses lazy type', () => {
      const { root } = parse(`\
contract M: {
    children: lazy(TreeNode)
}`);
      const type = root.models[0]!.fields[0]!.type as LazyTypeNode;
      expect(type.kind).toBe('lazy');
      expect(type.inner).toMatchObject({ kind: 'ref', name: 'TreeNode' });
    });
  });

  // ─── Inline objects ─────────────────────────────────────────────

  describe('inline objects', () => {
    it('parses inline brace objects', () => {
      const { root } = parse(`\
contract M: {
    meta: { key: string, value: number }
}`);
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
      const field = root.models[0]!.fields[0]!;
      expect(field.type.kind).toBe('inlineObject');
      const obj = field.type as InlineObjectTypeNode;
      expect(obj.fields).toHaveLength(2);
    });
  });

  // ─── Model inheritance ──────────────────────────────────────────

  describe('model inheritance', () => {
    it('parses model with base model', () => {
      const { root } = parse(`\
contract Admin: User & {
    role: string
}`);
      expect(root.models[0]!.base).toBe('User');
      expect(root.models[0]!.name).toBe('Admin');
    });
  });

  // ─── Model descriptions ────────────────────────────────────────

  describe('model descriptions', () => {
    it('parses model description from preceding comment', () => {
      const { root } = parse(`\
# Represents a user
contract User: {
    name: string
}`);
      expect(root.models[0]!.description).toBe('Represents a user');
    });

    it('parses model description from inline comment', () => {
      const { root } = parse(`\
contract User: { # A user model
    name: string
}`);
      expect(root.models[0]!.description).toBe('A user model');
    });
  });

  // ─── Error recovery ────────────────────────────────────────────

  describe('error recovery', () => {
    it('collects parse errors in diagnostics', () => {
      const { diag } = parse(`\
contract M: {
    : string
}`);
      expect(diag.hasErrors()).toBe(true);
    });

    it('reports error on malformed input', () => {
      const { root, diag } = parse(`\
contract Bad: {
    : string
}

contract Good: {
    name: string
}`);
      // PEG parser fails on first error and reports it in diagnostics.
      // Unlike recovery-based parsers, subsequent models may not be returned.
      expect(diag.hasErrors()).toBe(true);
    });
  });

  // ─── Source locations ───────────────────────────────────────────

  describe('source locations', () => {
    it('records correct line numbers on models and fields', () => {
      const { root } = parse(`\
contract User: {
    name: string
    age: number
}`);
      expect(root.models[0]!.loc.line).toBe(1);
      expect(root.models[0]!.fields[0]!.loc.line).toBe(2);
      expect(root.models[0]!.fields[1]!.loc.line).toBe(3);
    });

    it('records the correct file name', () => {
      const { root } = parse('contract M: { f: string }');
      expect(root.file).toBe('test.ck');
      expect(root.models[0]!.loc.file).toBe('test.ck');
    });
  });

  // ─── Options block ─────────────────────────────────────────────

  describe('options block', () => {
    it('parses an empty options block', () => {
      const { root, diag } = parse(`\
options {}

contract User: {
    name: string
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.meta).toEqual({});
      expect(root.models).toHaveLength(1);
    });

    it('parses options block with a single unquoted entry', () => {
      const { root, diag } = parse(`\
options {
    keys: {
        area: users
    }
}

contract Account: {
    id: uuid
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.meta).toEqual({ area: 'users' });
      expect(root.models).toHaveLength(1);
      expect(root.models[0]!.name).toBe('Account');
    });

    it('parses options block with multiple entries', () => {
      const { root, diag } = parse(`\
options {
    keys: {
        area: billing
        module: payments
        version: v2
    }
}

contract Invoice: {
    total: number
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.meta).toEqual({
        area: 'billing',
        module: 'payments',
        version: 'v2',
      });
      expect(root.models).toHaveLength(1);
    });

    it('parses options block with quoted string values', () => {
      const { root, diag } = parse(`\
options {
    keys: {
        area: "user-management"
        label: 'User Management'
    }
}

contract User: {
    name: string
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.meta).toEqual({
        area: 'user-management',
        label: 'User Management',
      });
    });

    it('returns empty meta when no options block is present', () => {
      const { root } = parse(`\
contract User: {
    name: string
}`);
      expect(root.meta).toEqual({});
    });

    it('parses options block followed by multiple models', () => {
      const { root, diag } = parse(`\
options {
    keys: {
        area: users
    }
}

contract User: {
    name: string
}

contract Admin: User & {
    role: string
}`);
      expect(diag.hasErrors()).toBe(false);
      expect(root.meta).toEqual({ area: 'users' });
      expect(root.models).toHaveLength(2);
      expect(root.models[0]!.name).toBe('User');
      expect(root.models[1]!.name).toBe('Admin');
    });
  });
});
