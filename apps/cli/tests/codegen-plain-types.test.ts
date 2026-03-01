import { describe, it, expect } from 'vitest';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import type { DtoCodegenContext } from '../src/codegen-dto.js';
import {
  scalarType, arrayType, tupleType, recordType, enumType,
  literalType, unionType, refType, lazyType, inlineObjectType,
  field, model, dtoRoot,
} from './helpers.js';

describe('generatePlainTypes', () => {
  // ─── Simple model ──────────────────────────────────────────────

  describe('simple model', () => {
    it('generates interface with fields', () => {
      const root = dtoRoot([
        model('User', [
          field('name', scalarType('string')),
          field('age', scalarType('number')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export interface User {');
      expect(output).toContain('name: string;');
      expect(output).toContain('age: number;');
    });

    it('does not contain Zod imports or references', () => {
      const root = dtoRoot([
        model('User', [
          field('name', scalarType('string')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).not.toContain('zod');
      expect(output).not.toContain('z.');
      expect(output).not.toContain('z.infer');
    });

    it('does not contain luxon imports for date fields', () => {
      const root = dtoRoot([
        model('Event', [
          field('startDate', scalarType('date')),
          field('endDate', scalarType('datetime')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).not.toContain('luxon');
      expect(output).not.toContain('DateTime');
      expect(output).toContain('startDate: string;');
      expect(output).toContain('endDate: string;');
    });
  });

  // ─── Scalar type mapping ──────────────────────────────────────

  describe('scalar type mapping', () => {
    it('maps string types to string', () => {
      const root = dtoRoot([
        model('M', [
          field('s', scalarType('string')),
          field('e', scalarType('email')),
          field('u', scalarType('url')),
          field('uid', scalarType('uuid')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('s: string;');
      expect(output).toContain('e: string;');
      expect(output).toContain('u: string;');
      expect(output).toContain('uid: string;');
    });

    it('maps numeric types correctly', () => {
      const root = dtoRoot([
        model('M', [
          field('n', scalarType('number')),
          field('i', scalarType('int')),
          field('b', scalarType('bigint')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('n: number;');
      expect(output).toContain('i: number;');
      expect(output).toContain('b: bigint;');
    });

    it('maps boolean type', () => {
      const root = dtoRoot([
        model('M', [field('active', scalarType('boolean'))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('active: boolean;');
    });

    it('maps special types correctly', () => {
      const root = dtoRoot([
        model('M', [
          field('a', scalarType('any')),
          field('u', scalarType('unknown')),
          field('n', scalarType('null')),
          field('o', scalarType('object')),
          field('bin', scalarType('binary')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('a: any;');
      expect(output).toContain('u: unknown;');
      expect(output).toContain('n: null;');
      expect(output).toContain('o: Record<string, unknown>;');
      expect(output).toContain('bin: Blob;');
    });
  });

  // ─── Compound types ───────────────────────────────────────────

  describe('compound types', () => {
    it('renders array type', () => {
      const root = dtoRoot([
        model('M', [field('items', arrayType(scalarType('string')))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('items: string[];');
    });

    it('renders array of refs', () => {
      const root = dtoRoot([
        model('M', [field('users', arrayType(refType('User')))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('users: User[];');
    });

    it('renders tuple type', () => {
      const root = dtoRoot([
        model('M', [field('pair', tupleType(scalarType('number'), scalarType('string')))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('pair: [number, string];');
    });

    it('renders record type', () => {
      const root = dtoRoot([
        model('M', [field('data', recordType(scalarType('string'), scalarType('number')))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('data: Record<string, number>;');
    });

    it('renders enum type as union of literals', () => {
      const root = dtoRoot([
        model('M', [field('role', enumType('admin', 'user', 'guest'))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain("role: 'admin' | 'user' | 'guest';");
    });

    it('renders literal types', () => {
      const root = dtoRoot([
        model('M', [
          field('kind', literalType('message')),
          field('count', literalType(42)),
          field('flag', literalType(true)),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain("kind: 'message';");
      expect(output).toContain('count: 42;');
      expect(output).toContain('flag: true;');
    });

    it('renders union type', () => {
      const root = dtoRoot([
        model('M', [field('value', unionType(scalarType('string'), scalarType('number')))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('value: string | number;');
    });

    it('renders model reference as type name', () => {
      const root = dtoRoot([
        model('M', [field('user', refType('User'))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('user: User;');
    });

    it('renders lazy type transparently', () => {
      const root = dtoRoot([
        model('TreeNode', [field('children', arrayType(lazyType(refType('TreeNode'))))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('children: TreeNode[];');
    });

    it('renders inline object type', () => {
      const root = dtoRoot([
        model('M', [field('data', inlineObjectType([
          field('key', scalarType('string')),
          field('value', scalarType('number')),
        ]))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('data: { key: string; value: number };');
    });
  });

  // ─── Field modifiers ──────────────────────────────────────────

  describe('field modifiers', () => {
    it('renders optional field with ?', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { optional: true })]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('f?: string;');
    });

    it('renders nullable field with | null', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { nullable: true })]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('f: string | null;');
    });

    it('renders field with default as optional', () => {
      const root = dtoRoot([
        model('M', [field('active', scalarType('boolean'), { default: true })]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('active?: boolean;');
    });

    it('renders nullable + optional field', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { optional: true, nullable: true })]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('f?: string | null;');
    });
  });

  // ─── Type alias ────────────────────────────────────────────────

  describe('type alias', () => {
    it('generates type alias for type-only models', () => {
      const root = dtoRoot([
        model('Currency', [], { type: scalarType('string') }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export type Currency = string;');
      expect(output).not.toContain('interface');
    });

    it('generates type alias for complex types', () => {
      const root = dtoRoot([
        model('UserIds', [], { type: arrayType(scalarType('uuid')) }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export type UserIds = string[];');
    });
  });

  // ─── Visibility (read/write) ──────────────────────────────────

  describe('visibility pattern', () => {
    it('generates read and write interfaces for models with visibility', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
          field('password', scalarType('string'), { visibility: 'writeonly' }),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export interface User {');
      expect(output).toContain('export interface UserInput {');
    });

    it('read interface omits writeonly fields', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
          field('password', scalarType('string'), { visibility: 'writeonly' }),
        ]),
      ]);
      const output = generatePlainTypes(root);
      const userSection = output.split('export interface User {')[1]!.split('}')[0]!;
      expect(userSection).toContain('id: string;');
      expect(userSection).toContain('name: string;');
      expect(userSection).not.toContain('password');
    });

    it('write interface omits readonly fields', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
          field('password', scalarType('string'), { visibility: 'writeonly' }),
        ]),
      ]);
      const output = generatePlainTypes(root);
      const inputSection = output.split('export interface UserInput {')[1]!.split('}')[0]!;
      expect(inputSection).toContain('name: string;');
      expect(inputSection).toContain('password: string;');
      expect(inputSection).not.toContain('id');
    });
  });

  // ─── Inheritance ──────────────────────────────────────────────

  describe('inheritance', () => {
    it('generates extends clause for models with a base', () => {
      const root = dtoRoot([
        model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export interface Admin extends User {');
    });

    it('generates extends for visibility model with base', () => {
      const root = dtoRoot([
        model('Admin', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('role', scalarType('string')),
        ], { base: 'User' }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export interface Admin extends User {');
      expect(output).toContain('export interface AdminInput extends UserInput {');
    });
  });

  // ─── JSDoc comments ───────────────────────────────────────────

  describe('comments', () => {
    it('includes model description in JSDoc', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))], { description: 'A system user' }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('* A system user');
    });

    it('includes source location in JSDoc', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))], { loc: { file: 'user.dto', line: 5 } }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('file://./user.dto#L5');
    });
  });

  // ─── Import resolution ─────────────────────────────────────────

  describe('import resolution', () => {
    it('uses type-only imports for external references', () => {
      const root = dtoRoot([
        model('Counterparty', [
          field('accounts', arrayType(refType('CounterpartyAccount'))),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain("import type { CounterpartyAccount } from './counterparty.account.js';");
    });

    it('does not import locally defined models', () => {
      const root = dtoRoot([
        model('Currency', [field('code', scalarType('string'))]),
        model('Account', [field('currency', refType('Currency'))]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).not.toContain("import type { Currency }");
    });

    it('resolves imports using modelOutPaths context', () => {
      const root = dtoRoot([
        model('Transfer', [
          field('account', refType('LedgerAccount')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/modules/transfers/transfer.ts',
        modelOutPaths: new Map([
          ['LedgerAccount', '/out/modules/ledger/ledger.account.ts'],
        ]),
      };
      const output = generatePlainTypes(root, context);
      expect(output).toContain("import type { LedgerAccount } from '../ledger/ledger.account.js';");
    });

    it('falls back to pascalToDotCase when ref not in modelOutPaths', () => {
      const root = dtoRoot([
        model('Order', [field('item', refType('UnknownExternal'))]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/order.ts',
        modelOutPaths: new Map(),
      };
      const output = generatePlainTypes(root, context);
      expect(output).toContain("import type { UnknownExternal } from './unknown.external.js';");
    });

    it('imports base model when inherited from external', () => {
      const root = dtoRoot([
        model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain("import type { User } from './user.js';");
    });
  });

  // ─── Topological sorting ───────────────────────────────────────

  describe('topological sorting', () => {
    it('emits dependencies before dependents', () => {
      const root = dtoRoot([
        model('B', [field('a', refType('A'))]),
        model('A', [field('name', scalarType('string'))]),
      ]);
      const output = generatePlainTypes(root);
      const aIndex = output.indexOf('export interface A {');
      const bIndex = output.indexOf('export interface B {');
      expect(aIndex).toBeLessThan(bIndex);
    });
  });

  // ─── Multiple models ───────────────────────────────────────────

  describe('multiple models', () => {
    it('generates all models in one output', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid')),
          field('name', scalarType('string')),
        ]),
        model('Post', [
          field('id', scalarType('uuid')),
          field('title', scalarType('string')),
          field('author', refType('User')),
        ]),
      ]);
      const output = generatePlainTypes(root);
      expect(output).toContain('export interface User {');
      expect(output).toContain('export interface Post {');
      expect(output).toContain('author: User;');
      // No import for User since it's local
      expect(output).not.toContain("import type { User }");
    });
  });
});
