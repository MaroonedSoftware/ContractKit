import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';
import { resolveModifiers, resolveSecurity, SECURITY_NONE, SCALAR_NAMES } from '../src/ast.js';
import type {
    ScalarTypeNode,
    ArrayTypeNode,
    TupleTypeNode,
    RecordTypeNode,
    EnumTypeNode,
    LiteralTypeNode,
    UnionTypeNode,
    DiscriminatedUnionTypeNode,
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
            // Driven off SCALAR_NAMES rather than a copy of it: a hand-maintained list here would
            // silently stop covering any scalar added later.
            expect(SCALAR_NAMES.size).toBeGreaterThan(0);
            for (const name of SCALAR_NAMES) {
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

        it('parses enum type with quoted string values', () => {
            const { root, diag } = parse('contract M: { status: enum("Sole Proprietorship", LLC, "C-Corp Inc") }');
            expect(diag.hasErrors()).toBe(false);
            const type = root.models[0]!.fields[0]!.type as EnumTypeNode;
            expect(type.kind).toBe('enum');
            expect(type.values).toEqual(['Sole Proprietorship', 'LLC', 'C-Corp Inc']);
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

        it('parses discriminated union type', () => {
            const { root } = parse('contract M: { method: discriminated(by=kind, Card | Bank | Wire) }');
            const type = root.models[0]!.fields[0]!.type as DiscriminatedUnionTypeNode;
            expect(type.kind).toBe('discriminatedUnion');
            expect(type.discriminator).toBe('kind');
            expect(type.members).toHaveLength(3);
            expect((type.members[0] as ModelRefTypeNode).name).toBe('Card');
            expect((type.members[1] as ModelRefTypeNode).name).toBe('Bank');
            expect((type.members[2] as ModelRefTypeNode).name).toBe('Wire');
        });

        it('parses leading-pipe union (multi-line readability)', () => {
            const { root } = parse(`
                contract AuthRequest:
                    | ClientCredentials
                    | Password
                    | RefreshToken
            `);
            const type = root.models[0]!.type as UnionTypeNode;
            expect(type.kind).toBe('union');
            expect(type.members).toHaveLength(3);
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
            expect(root.models[0]!.bases).toEqual(['User']);
            expect(root.models[0]!.name).toBe('Admin');
        });

        it('parses intersection with inline object as inheritance', () => {
            const { root } = parse('contract Query: Pagination & { status?: enum(pending, posted) }');
            expect(root.models[0]!.bases).toEqual(['Pagination']);
            expect(root.models[0]!.fields[0]!.name).toBe('status');
            expect(root.models[0]!.fields[0]!.optional).toBe(true);
        });

        it('parses model with multiple bases', () => {
            const { root } = parse('contract Test5: Test1 & Test2 & Test3 & Test4 & { e: string }');
            expect(root.models[0]!.bases).toEqual(['Test1', 'Test2', 'Test3', 'Test4']);
            expect(root.models[0]!.fields[0]!.name).toBe('e');
        });

        it('parses override modifier on a field', () => {
            const { root } = parse('contract Test5: Test1 & { a: override int }');
            const field = root.models[0]!.fields[0]!;
            expect(field.name).toBe('a');
            expect(field.override).toBe(true);
            expect(field.type).toEqual({ kind: 'scalar', name: 'int' });
        });

        it('parses override combined with other modifiers in any order', () => {
            const { root } = parse(`
contract Test5: Test1 & {
    a: override readonly string
    b: deprecated override int
    c: override deprecated readonly string
}`);
            const fields = root.models[0]!.fields;
            expect(fields[0]).toMatchObject({ name: 'a', override: true, visibility: 'readonly' });
            expect(fields[1]).toMatchObject({ name: 'b', override: true, deprecated: true });
            expect(fields[2]).toMatchObject({ name: 'c', override: true, deprecated: true, visibility: 'readonly' });
        });

        it('errors on conflicting visibility modifiers', () => {
            const { diag } = parse('contract Test: { a: readonly writeonly string }');
            const errs = diag.getAll().filter(d => d.severity === 'error');
            expect(errs.some(e => e.message.includes('Conflicting visibility'))).toBe(true);
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

        it('parses type alias with discriminated union', () => {
            const { root, diag } = parse('contract PaymentMethod: discriminated(by=kind, Card | Bank | Wire)');
            expect(diag.hasErrors()).toBe(false);
            const type = root.models[0]!.type as DiscriminatedUnionTypeNode;
            expect(type.kind).toBe('discriminatedUnion');
            expect(type.discriminator).toBe('kind');
            expect(type.members).toHaveLength(3);
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

        it('parses params with constraint arguments', () => {
            const { root, diag } = parse(`\
operation /orders/{orderId}: {
    params: {
        orderId: int(min=1, max=5)
    }
    get: {}
}`);
            expect(diag.hasErrors()).toBe(false);
            const param = (root.routes[0]!.params as any).nodes[0];
            expect(param.name).toBe('orderId');
            expect(param.type).toMatchObject({
                kind: 'scalar',
                name: 'int',
                min: 1,
                max: 5,
            });
        });

        it('parses params with enum type', () => {
            const { root, diag } = parse(`\
operation /pets/{status}: {
    params: {
        status: enum(available, pending, sold)
    }
    get: {}
}`);
            expect(diag.hasErrors()).toBe(false);
            const param = (root.routes[0]!.params as any).nodes[0];
            expect(param.type).toMatchObject({ kind: 'enum', values: ['available', 'pending', 'sold'] });
        });

        it('parses params with regex constraint', () => {
            const { root, diag } = parse(`\
operation /users/{slug}: {
    params: {
        slug: string(regex=/^[a-z0-9-]+$/)
    }
    get: {}
}`);
            expect(diag.hasErrors()).toBe(false);
            const param = (root.routes[0]!.params as any).nodes[0];
            expect(param.type).toMatchObject({ kind: 'scalar', name: 'string' });
            expect(param.type.regex).toBeDefined();
        });

        it('preserves description comment alongside complex param type', () => {
            const { root, diag } = parse(`\
operation /orders/{id}: {
    params: {
        id: int(min=1) # the order id
    }
    get: {}
}`);
            expect(diag.hasErrors()).toBe(false);
            const param = (root.routes[0]!.params as any).nodes[0];
            expect(param.description).toBe('the order id');
            expect(param.type).toMatchObject({ kind: 'scalar', name: 'int', min: 1 });
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
            expect(req!.bodies).toHaveLength(1);
            expect(req!.bodies[0]!.contentType).toBe('application/json');
            expect(req!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'CreateUserInput' });
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
            const req = root.routes[0]!.operations[0]!.request;
            expect(req!.bodies).toHaveLength(1);
            expect(req!.bodies[0]!.contentType).toBe('multipart/form-data');
        });

        it('parses multi-MIME request preserving source order', () => {
            const { root } = parse(`\
operation /auth/token: {
    post: {
        request: {
            application/json: AuthRequest
            application/x-www-form-urlencoded: AuthRequest
        }
    }
}`);
            const req = root.routes[0]!.operations[0]!.request;
            expect(req!.bodies).toHaveLength(2);
            expect(req!.bodies.map(b => b.contentType)).toEqual([
                'application/json',
                'application/x-www-form-urlencoded',
            ]);
            expect(req!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'AuthRequest' });
            expect(req!.bodies[1]!.bodyType).toEqual({ kind: 'ref', name: 'AuthRequest' });
        });

        it('accepts mime types with non-identifier characters like + and vendor suffixes', () => {
            const { root, diag } = parse(`\
operation /foo: {
    post: {
        request: {
            application/vnd.api+json: Body
        }
        response: {
            200: {
                application/vnd.api+json: Body
            }
        }
    }
}`);
            const op = root.routes[0]!.operations[0]!;
            expect(op.request!.bodies[0]!.contentType).toBe('application/vnd.api+json');
            expect(op.responses[0]!.bodies[0]!.contentType).toBe('application/vnd.api+json');
            expect(diag.getAll()).toEqual([]);
        });

        it('lowercases content types for stable comparison', () => {
            const { root } = parse(`\
operation /foo: {
    post: {
        request: { Application/JSON: Body }
        response: { 200: { Application/JSON: Body } }
    }
}`);
            const op = root.routes[0]!.operations[0]!;
            expect(op.request!.bodies[0]!.contentType).toBe('application/json');
            expect(op.responses[0]!.bodies[0]!.contentType).toBe('application/json');
        });

        it('warns and dedupes when the same content type is declared twice', () => {
            const { root, diag } = parse(`\
operation /foo: {
    post: {
        request: {
            application/json: A
            application/json: B
        }
    }
}`);
            const req = root.routes[0]!.operations[0]!.request;
            expect(req!.bodies).toHaveLength(1);
            expect(req!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'A' });
            const warnings = diag.getAll().filter(e => /Duplicate request content type/.test(e.message));
            expect(warnings).toHaveLength(1);
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
            expect(responses[0]!.bodies[0]!.contentType).toBe('application/json');
            expect(responses[0]!.bodies[0]!.bodyType).toEqual({ kind: 'array', item: { kind: 'ref', name: 'User' } });
        });

        it('parses response with no body', () => {
            const { root } = parse('operation /r: { delete: { response: { 204: } } }');
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses[0]!.statusCode).toBe(204);
            expect(responses[0]!.bodies).toHaveLength(0);
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
            expect(responses[0]!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'User' });
            expect(responses[1]!.statusCode).toBe(404);
            expect(responses[1]!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'ErrorBody' });
            expect(responses[2]!.statusCode).toBe(204);
            expect(responses[2]!.bodies).toHaveLength(0);
        });

        it('distinguishes a bare status from one with an empty block', () => {
            const { root, diag } = parse('operation /r: { get: { response: { 304: \n 404: {} } } }');
            expect(diag.hasErrors()).toBe(false);
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses[0]!.hasBlock).toBeUndefined();
            expect(responses[1]!.hasBlock).toBe(true);
        });

        it('rejects whitespace around the status modifier, as `get (internal)` is rejected', () => {
            // The rule is lexical for a reason: a syntactic one would skip whitespace that the
            // TextMate grammar and the prettier printer both assume is absent, so a spaced form
            // would parse, never highlight, and get silently reformatted.
            for (const written of ['404 (documented):', '404( documented ):', '404 ( documented ) :']) {
                const { diag } = parse(`operation /p: { get: { response: { ${written} } } }`);
                expect(diag.hasErrors(), `${written} should not parse`).toBe(true);
            }
        });

        it('parses the documented status modifier', () => {
            const { root, diag } = parse(`\
operation /pet: {
    get: {
        response: {
            200: { application/json: Pet }
            404(documented): { application/json: Problem }
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses[0]!.emit).toBeUndefined();
            expect(responses[1]!.emit).toBe('documented');
            expect(responses[1]!.bodies).toHaveLength(1);
        });

        it('parses the documented modifier on a bodyless status', () => {
            const { root, diag } = parse('operation /r: { get: { response: { 202(documented): } } }');
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.responses[0]!.emit).toBe('documented');
        });

        it('parses several content types under one status code', () => {
            const { root, diag } = parse(`\
operation /art/{id}: {
    get: {
        response: {
            200: {
                image/png: binary
                image/jpeg: binary
            }
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses[0]!.bodies).toEqual([
                { contentType: 'image/png', bodyType: { kind: 'scalar', name: 'binary' } },
                { contentType: 'image/jpeg', bodyType: { kind: 'scalar', name: 'binary' } },
            ]);
            // Deprecated mirrors still point at the first declared body.
            expect(responses[0]!.bodies[0]!.contentType).toBe('image/png');
        });

        it('warns only when the same mime is declared twice for one status', () => {
            const { root, diag } = parse(`\
operation /art/{id}: {
    get: {
        response: {
            200: {
                image/png: binary
                image/png: binary
            }
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            expect(diag.getAll().some(d => d.message.includes("Duplicate response body for 'image/png' on status 200"))).toBe(true);
            expect(root.routes[0]!.operations[0]!.responses[0]!.bodies).toHaveLength(1);
        });

        it('parses response headers alongside content type', () => {
            const { root, diag } = parse(`\
operation /transfers/{id}: {
    get: {
        response: {
            200: {
                application/json: Transfer
                headers: {
                    preference-applied?: string
                    vary?: string
                    etag: string # cache validator
                }
            }
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses).toHaveLength(1);
            expect(responses[0]!.bodies[0]!.bodyType).toEqual({ kind: 'ref', name: 'Transfer' });
            const headers = responses[0]!.headers!;
            expect(headers).toHaveLength(3);
            expect(headers[0]).toMatchObject({ name: 'preference-applied', optional: true });
            expect(headers[0]!.type).toEqual({ kind: 'scalar', name: 'string' });
            expect(headers[1]).toMatchObject({ name: 'vary', optional: true });
            expect(headers[2]).toMatchObject({ name: 'etag', optional: false, description: 'cache validator' });
        });

        it('parses response headers without a content type body', () => {
            const { root, diag } = parse(`\
operation /resources/{id}: {
    delete: {
        response: {
            204: {
                headers: {
                    x-deleted-at: string
                }
            }
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            const responses = root.routes[0]!.operations[0]!.responses;
            expect(responses).toHaveLength(1);
            expect(responses[0]!.statusCode).toBe(204);
            expect(responses[0]!.bodies).toHaveLength(0);
            expect(responses[0]!.headers).toHaveLength(1);
            expect(responses[0]!.headers![0]!.name).toBe('x-deleted-at');
        });

        it('warns on duplicate response headers block', () => {
            const { diag } = parse(`\
operation /r: {
    get: {
        response: {
            200: {
                application/json: User
                headers: { etag: string }
                headers: { etag: string }
            }
        }
    }
}`);
            const warnings = diag.getAll().filter(e => /Duplicate response headers/.test(e.message));
            expect(warnings).toHaveLength(1);
        });

        it('warns on duplicate response header name', () => {
            const { diag } = parse(`\
operation /r: {
    get: {
        response: {
            200: {
                headers: {
                    etag: string
                    etag: string
                }
            }
        }
    }
}`);
            const warnings = diag.getAll().filter(e => /Duplicate response header/.test(e.message));
            expect(warnings).toHaveLength(1);
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

    // ─── Name declaration ────────────────────────────────────────────

    describe('name declaration', () => {
        it('parses a single-word name', () => {
            const { root } = parse('operation /users: { get: { name: Users } }');
            expect(root.routes[0]!.operations[0]!.name).toBe('Users');
        });

        it('parses a multi-word name', () => {
            const { root } = parse('operation /offers: { post: { name: Create an Offer } }');
            expect(root.routes[0]!.operations[0]!.name).toBe('Create an Offer');
        });

        it('parses name alongside service', () => {
            const { root } = parse('operation /users: { get: { name: List Users\n  service: UserService.list } }');
            expect(root.routes[0]!.operations[0]!.name).toBe('List Users');
            expect(root.routes[0]!.operations[0]!.service).toBe('UserService.list');
        });

        it('leaves name undefined when not declared', () => {
            expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.name).toBeUndefined();
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

    // ─── MCP declaration ─────────────────────────────────────────────

    describe('mcp declaration', () => {
        it('parses mcp: true', () => {
            const { root, diag } = parse('operation /users: { get: { mcp: true } }');
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.mcp).toBe(true);
        });

        it('parses mcp: false', () => {
            const { root, diag } = parse('operation /users: { get: { mcp: false } }');
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.mcp).toBe(false);
        });

        it('leaves mcp undefined when not declared', () => {
            expect(parse('operation /users: { get: {} }').root.routes[0]!.operations[0]!.mcp).toBeUndefined();
        });

        it('parses mcp block with text fields and mixed hint tokens', () => {
            const { root, diag } = parse(`\
operation /routes: {
    post: {
        mcp: {
            name: "searchRoutes"
            title: "Search routes"
            description: "Full-text search across routes."
            hint: readOnly, idempotent, nonDestructive
        }
    }
}`);
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.mcp).toMatchObject({
                name: 'searchRoutes',
                title: 'Search routes',
                description: 'Full-text search across routes.',
                readOnlyHint: true,
                idempotentHint: true,
                destructiveHint: false,
            });
            // Unlisted hint left unset.
            expect((root.routes[0]!.operations[0]!.mcp as any).openWorldHint).toBeUndefined();
        });

        it('parses closedWorld / nonIdempotent negative tokens', () => {
            const { root, diag } = parse('operation /r: { get: { mcp: { hint: closedWorld, nonIdempotent } } }');
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.mcp).toMatchObject({ openWorldHint: false, idempotentHint: false });
        });

        it('errors on unknown mcp setting key', () => {
            const { diag } = parse('operation /r: { get: { mcp: { bogus: "x" } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /Unknown mcp setting 'bogus'/.test(d.message))).toBe(true);
        });

        it('errors when a text field is given a token list', () => {
            const { diag } = parse('operation /r: { get: { mcp: { name: searchRoutes } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /'name' expects a quoted string/.test(d.message))).toBe(true);
        });

        it('errors when hint is given a quoted string', () => {
            const { diag } = parse('operation /r: { get: { mcp: { hint: "readOnly" } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /'hint' expects a comma-separated token list/.test(d.message))).toBe(true);
        });

        it('errors on unknown hint token', () => {
            const { diag } = parse('operation /r: { get: { mcp: { hint: sideEffectFree } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /Unknown mcp hint 'sideEffectFree'/.test(d.message))).toBe(true);
        });

        it('errors on conflicting hint pair', () => {
            const { diag } = parse('operation /r: { get: { mcp: { hint: readOnly, nonReadOnly } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /Conflicting or duplicate mcp hint 'nonReadOnly'/.test(d.message))).toBe(true);
        });

        it('errors on duplicate setting key', () => {
            const { diag } = parse('operation /r: { get: { mcp: { name: "a"\n  name: "b" } } }');
            expect(diag.getAll().some(d => d.severity === 'error' && /Duplicate mcp setting 'name'/.test(d.message))).toBe(true);
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

        it('parses security: { policy: someName }', () => {
            const { root } = parse('operation /users: { get: { security: { policy: paymentsWrite } } }');
            expect((root.routes[0]!.operations[0]!.security as any).policy).toBe('paymentsWrite');
        });

        it('parses security: { policy: none } as explicit bypass', () => {
            const { root } = parse('operation /users: { get: { security: { policy: none } } }');
            expect((root.routes[0]!.operations[0]!.security as any).policy).toBe(false);
        });

        it('parses policy comment description in security block', () => {
            const { root, diag } = parse('operation /users: { get: { security: { policy: paymentsWrite # write scope\n} } }');
            expect(diag.hasErrors()).toBe(false);
            const sec = root.routes[0]!.operations[0]!.security as any;
            expect(sec.policy).toBe('paymentsWrite');
            expect(sec.policyDescription).toBe('write scope');
        });

        it('keeps a bare # in a name, and still ends the name at whitespace-#', () => {
            const nameOf = (s: string) => parse(s).root.routes[0]!.operations[0]!.name;
            // A bare `#` is data, matching an unquoted options value. It used to end the name,
            // silently truncating `Generate C# client` to `Generate C`.
            expect(nameOf('operation /x: { get: { name: Generate C# client\n} }')).toBe('Generate C# client');
            expect(nameOf('operation /x: { get: { name: List pets # doc\n} }')).toBe('List pets');
            expect(nameOf('operation /x: { get: { name: List pets } }')).toBe('List pets');
        });

        it('accepts a comment after the last declaration', () => {
            const { root, diag } = parse('contract A: enum(a, b)\n\n# TODO: add the archived state\n');
            expect(diag.hasErrors()).toBe(false);
            expect(root.trailingComments).toEqual(['TODO: add the archived state']);
        });

        it('attributes a comment between declarations by line', () => {
            const { root, diag } = parse('contract A: enum(a, b) # alias doc\n\n# doc for B\ncontract B: { v: string }\n');
            expect(diag.hasErrors()).toBe(false);
            expect(root.models[0]!.description).toBe('alias doc');
            expect(root.models[0]!.descriptionInline).toBe(true);
            expect(root.models[1]!.description).toBe('doc for B');
            expect(root.models[1]!.leadingComments).toBeUndefined();
        });

        it('keeps a standalone comment above the policy line', () => {
            const { root, diag } = parse('operation /users: { get: { security: {\n# why this floor\npolicy: paymentsWrite\n} } }');
            expect(diag.hasErrors()).toBe(false);
            const sec = root.routes[0]!.operations[0]!.security as any;
            expect(sec.leadingComments).toEqual(['why this floor']);
            expect(sec.policyDescription).toBeUndefined();
        });

        it('keeps a standalone comment after the policy line', () => {
            const { root, diag } = parse('operation /users: { get: { security: {\npolicy: paymentsWrite\n# not scoped yet\n} } }');
            expect(diag.hasErrors()).toBe(false);
            const sec = root.routes[0]!.operations[0]!.security as any;
            expect(sec.trailingComments).toEqual(['not scoped yet']);
            // A comment on the *next* line is prose, not the policy's inline description.
            expect(sec.policyDescription).toBeUndefined();
        });

        it('keeps a comment run above the security key in an operation body', () => {
            const { root, diag } = parse('operation /users: { get: {\nname: List\n# a read, so it drops\nsecurity: { policy: view }\n} }');
            expect(diag.hasErrors()).toBe(false);
            expect(root.routes[0]!.operations[0]!.bodyLeadingComments?.security).toEqual(['a read, so it drops']);
        });

        it('keeps a comment run above a verb that has its own inline doc comment', () => {
            const { root, diag } = parse('operation /users: {\n# operator only\nget: { # Lists users\nname: List\n} }');
            expect(diag.hasErrors()).toBe(false);
            const op = root.routes[0]!.operations[0]!;
            expect(op.description).toBe('Lists users');
            expect(op.leadingComments).toEqual(['operator only']);
        });

        it('parses SecuritySignatureLine inside security block', () => {
            const { root, diag } = parse('operation /hooks: { post: { security: { signature: "hmac-key"\n  policy: webhookIn } } }');
            expect(diag.hasErrors()).toBe(false);
            expect((root.routes[0]!.operations[0]!.security as any).policy).toBe('webhookIn');
        });

        it('parses signature: "key" as operation-level field', () => {
            const { root } = parse('operation /users: { post: { signature: "hmac-sha256" } }');
            expect(root.routes[0]!.operations[0]!.signature).toBe('hmac-sha256');
        });

        it('parses signature: UNQUOTED_KEY', () => {
            const { root } = parse('operation /users: { post: { signature: MODERN_TREASURY_WEBHOOK } }');
            expect(root.routes[0]!.operations[0]!.signature).toBe('MODERN_TREASURY_WEBHOOK');
        });

        it('parses block-form signature with options and policy', () => {
            const { root, diag } = parse(
                'operation /hooks: { post: { signature: { options: SLACK_WEBHOOK\n  policy: slackSignatureValid } } }',
            );
            expect(diag.hasErrors()).toBe(false);
            const op = root.routes[0]!.operations[0]!;
            expect(op.signature).toBe('SLACK_WEBHOOK');
            expect(op.signaturePolicy).toBe('slackSignatureValid');
        });

        it('parses block-form signature with options only (no policy)', () => {
            const { root } = parse('operation /hooks: { post: { signature: { options: "hmac-sha256" } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.signature).toBe('hmac-sha256');
            expect(op.signaturePolicy).toBeUndefined();
        });

        it('leaves signaturePolicy undefined for the bare form', () => {
            const { root } = parse('operation /users: { post: { signature: MODERN_TREASURY_WEBHOOK } }');
            expect(root.routes[0]!.operations[0]!.signaturePolicy).toBeUndefined();
        });

        it('parses signature: alongside security: { policy }', () => {
            const { root } = parse('operation /users: { post: { signature: "hmac-sha256"\n  security: { policy: paymentsWrite } } }');
            expect(root.routes[0]!.operations[0]!.signature).toBe('hmac-sha256');
            expect((root.routes[0]!.operations[0]!.security as any).policy).toBe('paymentsWrite');
        });

        it('parses route-level security: { policy: someName }', () => {
            const { root } = parse('operation /users: { security: { policy: paymentsWrite }\n  get: {} }');
            expect((root.routes[0]!.security as any).policy).toBe('paymentsWrite');
        });

        it('resolveSecurity: op-level wins over route-level', () => {
            const { root } = parse('operation /users: { security: { policy: paymentsWrite }\n  get: { security: none } }');
            expect(resolveSecurity(root.routes[0]!, root.routes[0]!.operations[0]!)).toBe(SECURITY_NONE);
        });

        it('resolveSecurity: falls back to route-level when op has no security', () => {
            const { root } = parse('operation /users: { security: { policy: paymentsWrite }\n  get: {} }');
            expect((resolveSecurity(root.routes[0]!, root.routes[0]!.operations[0]!) as any).policy).toBe('paymentsWrite');
        });

        it('security: { ... } does not break subsequent fields', () => {
            const { root } = parse('operation /users: { get: { security: { policy: paymentsWrite }\n  response: { 200: } } }');
            expect((root.routes[0]!.operations[0]!.security as any).policy).toBe('paymentsWrite');
            expect(root.routes[0]!.operations[0]!.responses[0]!.statusCode).toBe(200);
        });
    });

    // ─── plugins block ───────────────────────────────────────────────

    describe('plugins block', () => {
        it('parses plugins block with a single object entry', () => {
            const { root } = parse('operation /auth/token: { post: { plugins: { bruno: { template: "file://request-token.yml" } } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({ bruno: { template: 'file://request-token.yml' } });
            expect(op.pluginExtensions).toBeUndefined();
        });

        it('parses plugins block with multiple entries', () => {
            const { root } = parse('operation /users: { post: { plugins: { bruno: { template: "file://create-user.yml" }\n  typescript: { stub: "file://stub.ts" } } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({
                bruno: { template: 'file://create-user.yml' },
                typescript: { stub: 'file://stub.ts' },
            });
        });

        it('parses scalar plugin values', () => {
            const { root } = parse('operation /users: { get: { plugins: { stringy: "x"\n  numy: 7\n  booly: true\n  nully: null } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({ stringy: 'x', numy: 7, booly: true, nully: null });
        });

        it('parses arrays and nested objects in plugin values', () => {
            const { root } = parse('operation /users: { get: { plugins: { bruno: { tags: ["a" "b"]\n  meta: { x: 1 } } } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({ bruno: { tags: ['a', 'b'], meta: { x: 1 } } });
        });

        it('parses empty plugins block', () => {
            const { root } = parse('operation /users: { get: { plugins: {} } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({});
        });

        it('plugins block does not affect other fields', () => {
            const { root } = parse('operation /users: { post: { plugins: { bruno: { template: "file://stub.yml" } }\n  response: { 201: } } }');
            const op = root.routes[0]!.operations[0]!;
            expect(op.plugins).toEqual({ bruno: { template: 'file://stub.yml' } });
            expect(op.responses[0]!.statusCode).toBe(201);
        });

        it('op without plugins block has undefined plugins', () => {
            const { root } = parse('operation /users: { get: {} }');
            expect(root.routes[0]!.operations[0]!.plugins).toBeUndefined();
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

    it('accepts a comment above the options keyword', () => {
        const { root, diag } = parse(`\
# ContractKit contracts for billing.
# Owned by the payments team.
options {
    keys: {
        area: billing
    }
}
contract Pet: { id: uuid }`);
        expect(diag.hasErrors()).toBe(false);
        expect(root.optionsComments?.leading).toEqual(['ContractKit contracts for billing.', 'Owned by the payments team.']);
        expect(root.meta).toEqual({ area: 'billing' });
    });

    it('does not let a leading comment on options steal a contract doc comment', () => {
        // OptionsBlock owns the `comment*`, so failing to find `options` backtracks the comments
        // and leaves them to the declaration below. On Root they would be swallowed instead.
        const { root, diag } = parse('# A pet for sale\ncontract Pet: { id: uuid }');
        expect(diag.hasErrors()).toBe(false);
        expect(root.models[0]!.description).toBe('A pet for sale');
    });

    it('treats a trailing comment on an options entry as a comment, not part of the value', () => {
        // The value used to swallow the comment and stop at the first `}`, so a brace inside it
        // closed the block early and silently mis-parsed the rest of the file.
        const { root, diag } = parse(`\
options {
    keys: {
        area: billing # interpolated elsewhere as {{area}}
    }
    services: {
        PetService: "#m/s.js"
    }
}
contract Pet: { id: uuid }`);
        expect(diag.hasErrors()).toBe(false);
        expect(root.meta).toEqual({ area: 'billing' });
        expect(root.services).toEqual({ PetService: '#m/s.js' });
        expect(root.optionsComments?.keys?.inline).toEqual({ area: 'interpolated elsewhere as {{area}}' });
    });

    it('keeps a bare # inside an unquoted value, since subpath imports start with one', () => {
        const { root, diag } = parse(`\
options {
    services: {
        A: #modules/a/a.service.js # the real service
    }
}
contract Pet: { id: uuid }`);
        expect(diag.hasErrors()).toBe(false);
        expect(root.services).toEqual({ A: '#modules/a/a.service.js' });
        expect(root.optionsComments?.services?.inline).toEqual({ A: 'the real service' });
    });

    it('records which entry values were written without quotes', () => {
        const { root, diag } = parse(`\
options {
    keys: {
        area: billing
    }
    services: {
        Bare: #modules/a/a.service.js
        Quoted: "#modules/b/b.service.js"
    }
}
contract Pet: { id: uuid }`);
        expect(diag.hasErrors()).toBe(false);
        // Formatting only — both forms yield the same string.
        expect(root.services).toEqual({ Bare: '#modules/a/a.service.js', Quoted: '#modules/b/b.service.js' });
        expect(root.optionsUnquoted?.services).toEqual(['Bare']);
        expect(root.optionsUnquoted?.keys).toEqual(['area']);
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
        policy: paymentsWrite
    }
}
operation /users: { get: {} }`);
        expect(diag.hasErrors()).toBe(false);
        expect((root.security as any).policy).toBe('paymentsWrite');
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

    it('accepts a comment sitting directly in the options block', () => {
        const { root, diag } = parse(
            'options {\n    # where these come from\n    keys: {\n        area: ledger\n    }\n}\ncontract User: { name: string }',
        );
        expect(diag.hasErrors()).toBe(false);
        expect(root.meta).toEqual({ area: 'ledger' });
        expect(root.optionsComments?.body?.leading).toEqual({ keys: ['where these come from'] });
    });

    it('attaches an options-block comment run to the sub-block below it', () => {
        const { root, diag } = parse(
            'options {\n    keys: {\n        area: ledger\n    }\n    # service wiring\n    # one per module\n    services: {\n        UserService: "#src/user.js"\n    }\n}\ncontract User: { name: string }',
        );
        expect(diag.hasErrors()).toBe(false);
        expect(root.optionsComments?.body?.leading).toEqual({ services: ['service wiring', 'one per module'] });
    });

    it('keeps a trailing options-block comment', () => {
        const { root, diag } = parse('options {\n    keys: {\n        area: ledger\n    }\n    # nothing below\n}\ncontract User: { name: string }');
        expect(diag.hasErrors()).toBe(false);
        expect(root.optionsComments?.body?.trailing).toEqual(['nothing below']);
    });

    it('accepts an options block containing only a comment', () => {
        const { root, diag } = parse('options {\n    # a note\n}\ncontract User: { name: string }');
        expect(diag.hasErrors()).toBe(false);
        expect(root.meta).toEqual({});
        expect(root.optionsComments?.body?.trailing).toEqual(['a note']);
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

// ─── Formatter round-trip metadata ───────────────────────────────────────────

// These fields carry the author's layout alongside the semantics. Codegen ignores them, but the
// prettier plugin needs them to reproduce a `.ck` file exactly — see the round-trip suite in
// apps/prettier-plugin.
describe('round-trip metadata', () => {
    it('separates a standalone comment block from a doc comment', () => {
        const { root } = parse('# ─── Section ───\n\n# A pet\ncontract Pet: {\n    id: int\n}');
        const pet = root.models[0]!;
        expect(pet.leadingComments).toEqual(['─── Section ───']);
        expect(pet.description).toBe('A pet');
        expect(pet.descriptionInline).toBeFalsy();
    });

    it('treats a comment directly above a declaration as its doc comment', () => {
        const { root } = parse('# A pet\ncontract Pet: {\n    id: int\n}');
        expect(root.models[0]!.leadingComments).toBeUndefined();
        expect(root.models[0]!.description).toBe('A pet');
    });

    it('attaches a standalone block above an operation to the route', () => {
        const { root } = parse('# ─── Pets ───\n\noperation /pet: {\n    get: {}\n}');
        expect(root.routes[0]!.leadingComments).toEqual(['─── Pets ───']);
        expect(root.routes[0]!.description).toBeUndefined();
    });

    it('records whether a contract description was written inline', () => {
        expect(parse('contract Pet: { # A pet\n    id: int\n}').root.models[0]!.descriptionInline).toBe(true);
        expect(parse('# A pet\ncontract Pet: {\n    id: int\n}').root.models[0]!.descriptionInline).toBeFalsy();
    });

    it('does not attribute an inline contract comment to the first field as well', () => {
        const { root } = parse('contract Pet: { # A pet\n    id: int\n}');
        expect(root.models[0]!.description).toBe('A pet');
        expect(root.models[0]!.fields[0]!.description).toBeUndefined();
    });

    it('records whether an operation description was written inline', () => {
        const inline = parse('operation /pet: {\n    get: { # fetch\n    }\n}').root.routes[0]!.operations[0]!;
        expect(inline.descriptionInline).toBe(true);
        expect(inline.description).toBe('fetch');

        const above = parse('operation /pet: {\n    # fetch\n    get: {\n    }\n}').root.routes[0]!.operations[0]!;
        expect(above.descriptionInline).toBe(false);
        expect(above.description).toBe('fetch');
    });

    it('records operation body keys in source order', () => {
        const { root } = parse('operation /pet: {\n    put: {\n        sdk: updatePet\n        service: PetService.update\n    }\n}');
        expect(root.routes[0]!.operations[0]!.keyOrder).toEqual(['sdk', 'service']);
    });

    it('records the reverse order just as faithfully', () => {
        const { root } = parse('operation /pet: {\n    put: {\n        service: PetService.update\n        sdk: updatePet\n    }\n}');
        expect(root.routes[0]!.operations[0]!.keyOrder).toEqual(['service', 'sdk']);
    });

    it('records a blank line before an operation', () => {
        const { root } = parse('operation /pet: {\n    get: {}\n\n    post: {}\n}');
        const [get, post] = root.routes[0]!.operations;
        expect(get!.blankLineBefore).toBeFalsy();
        expect(post!.blankLineBefore).toBe(true);
    });

    it('measures the blank line above a comment run, not below it', () => {
        const { root } = parse('operation /pet: {\n    get: {}\n\n    # creates a pet\n    post: {}\n}');
        expect(root.routes[0]!.operations[1]!.blankLineBefore).toBe(true);
    });

    it('records no blank line when operations are packed together', () => {
        const { root } = parse('operation /pet: {\n    get: {}\n    post: {}\n}');
        expect(root.routes[0]!.operations[1]!.blankLineBefore).toBeFalsy();
    });

    it('records a single-line response block as inline', () => {
        const { root } = parse('operation /pet: {\n    get: {\n        response: {\n            200: { application/json: Pet }\n        }\n    }\n}');
        expect(root.routes[0]!.operations[0]!.responses[0]!.inline).toBe(true);
    });

    it('does not mark a multi-line response block as inline', () => {
        const { root } = parse(
            'operation /pet: {\n    get: {\n        response: {\n            200: {\n                application/json: Pet\n            }\n        }\n    }\n}',
        );
        expect(root.routes[0]!.operations[0]!.responses[0]!.inline).toBeFalsy();
    });
});

describe('test.ck fixture', () => {
    it('parses the petstore fixture without errors', () => {
        const source = readFileSync(resolve(__dirname, '../../../contracts/test.ck'), 'utf-8');
        const { root, diag } = parse(source, 'test.ck');

        expect(diag.hasErrors()).toBe(false);
        expect(root.kind).toBe('ckRoot');

        expect(root.meta).toEqual({ area: 'petstore' });
        expect(root.services).toEqual({
            PetService: '#src/modules/pet/pet.service.js',
            StoreService: '#src/modules/store/store.service.js',
            UserService: '#src/modules/user/user.service.js',
        });

        const modelNames = root.models.map(m => m.name);
        expect(modelNames).toEqual([
            'Order',
            'Category',
            'User',
            'Tag',
            'Pet',
            'ApiResponse',
            'UpdatePetForm',
            'UploadFileForm',
        ]);

        const order = root.models.find(m => m.name === 'Order')!;
        expect(order.fields.find(f => f.name === 'id')!.visibility).toBe('readonly');
        expect(order.fields.find(f => f.name === 'status')!.default).toBe('placed');
        expect(order.fields.find(f => f.name === 'complete')!.default).toBe(false);

        const user = root.models.find(m => m.name === 'User')!;
        expect(user.fields.find(f => f.name === 'password')!.visibility).toBe('writeonly');
        expect(user.fields.find(f => f.name === 'firstName')!.optional).toBe(true);

        const pet = root.models.find(m => m.name === 'Pet')!;
        expect(pet.fields.find(f => f.name === 'name')!.optional).toBeFalsy();
        expect(pet.fields.find(f => f.name === 'tags')!.optional).toBe(true);

        const routePaths = root.routes.map(r => r.path);
        expect(routePaths).toEqual([
            '/pet',
            '/pet/findByStatus',
            '/pet/findByTags',
            '/pet/{petId}',
            '/pet/{petId}/uploadImage',
            '/store/inventory',
            '/store/order',
            '/store/order/{orderId}',
            '/user',
            '/user/createWithList',
            '/user/login',
            '/user/logout',
            '/user/{username}',
        ]);

        const findByTags = root.routes.find(r => r.path === '/pet/findByTags')!;
        expect(findByTags.modifiers).toEqual(['deprecated']);

        const petById = root.routes.find(r => r.path === '/pet/{petId}')!;
        expect(petById.params).toBeDefined();
        expect(petById.operations.map(o => o.method).sort()).toEqual(['delete', 'get', 'post']);

        const login = root.routes.find(r => r.path === '/user/login')!;
        const loginGet = login.operations.find(o => o.method === 'get')!;
        const ok = loginGet.responses!.find(r => r.statusCode === 200)!;
        expect(ok.headers?.map(h => h.name)).toEqual(['x-rate-limit', 'x-expires-after']);
    });
});
