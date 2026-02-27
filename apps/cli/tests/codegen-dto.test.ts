import { generateDto, renderType } from '../src/codegen-dto.js';
import type { DtoCodegenContext } from '../src/codegen-dto.js';
import {
  scalarType, arrayType, tupleType, recordType, enumType,
  literalType, unionType, refType, lazyType, inlineObjectType,
  field, model, dtoRoot,
} from './helpers.js';
import type { ScalarTypeNode } from '../src/ast.js';

describe('renderType', () => {
  // ─── Scalar types ───────────────────────────────────────────────

  describe('scalar types', () => {
    it('renders z.string()', () => {
      expect(renderType(scalarType('string'))).toBe('z.string()');
    });

    it('renders z.string() with min/max', () => {
      expect(renderType(scalarType('string', { min: 1, max: 100 }))).toBe('z.string().min(1).max(100)');
    });

    it('renders z.string() with min only', () => {
      expect(renderType(scalarType('string', { min: 5 }))).toBe('z.string().min(5)');
    });

    it('renders z.string() with max only', () => {
      expect(renderType(scalarType('string', { max: 50 }))).toBe('z.string().max(50)');
    });

    it('renders z.string() with length', () => {
      expect(renderType(scalarType('string', { len: 6 }))).toBe('z.string().length(6)');
    });

    it('renders z.string() with regex', () => {
      expect(renderType(scalarType('string', { regex: '[A-Z]+' }))).toBe('z.string().regex(/^[A-Z]+$/)');
    });

    it('renders z.string() with regex containing forward slashes', () => {
      expect(renderType(scalarType('string', { regex: 'https?://[^/]+/path' })))
        .toBe('z.string().regex(/^https?:\\/\\/[^\\/]+\\/path$/)');
    });

    it('renders z.number()', () => {
      expect(renderType(scalarType('number'))).toBe('z.number()');
    });

    it('renders z.number() with min', () => {
      expect(renderType(scalarType('number', { min: 0 }))).toBe('z.number().min(0)');
    });

    it('renders z.number() with min and max', () => {
      expect(renderType(scalarType('number', { min: 0, max: 100 }))).toBe('z.number().min(0).max(100)');
    });

    it('renders z.int()', () => {
      expect(renderType(scalarType('int'))).toBe('z.int()');
    });

    it('renders z.int() with constraints', () => {
      expect(renderType(scalarType('int', { min: 1, max: 10 }))).toBe('z.int().min(1).max(10)');
    });

    it('renders z.bigint()', () => {
      expect(renderType(scalarType('bigint'))).toBe('z.bigint()');
    });

    it('renders z.bigint() with constraints using n suffix', () => {
      const result = renderType(scalarType('bigint', { min: 0n, max: 100n }));
      expect(result).toBe('z.bigint().min(0n).max(100n)');
    });

    it('renders z.boolean()', () => {
      expect(renderType(scalarType('boolean'))).toBe('z.boolean()');
    });

    it('renders DateTime custom validator for date', () => {
      const result = renderType(scalarType('date'));
      expect(result).toContain('z.custom<DateTime>');
      expect(result).toContain('DateTime');
    });

    it('renders DateTime custom validator for datetime', () => {
      const result = renderType(scalarType('datetime'));
      expect(result).toContain('z.custom<DateTime>');
    });

    it('renders z.email()', () => {
      expect(renderType(scalarType('email'))).toBe('z.email()');
    });

    it('renders z.url()', () => {
      expect(renderType(scalarType('url'))).toBe('z.url()');
    });

    it('renders z.uuid()', () => {
      expect(renderType(scalarType('uuid'))).toBe('z.uuid()');
    });

    it('renders z.any()', () => {
      expect(renderType(scalarType('any'))).toBe('z.any()');
    });

    it('renders z.unknown()', () => {
      expect(renderType(scalarType('unknown'))).toBe('z.unknown()');
    });

    it('renders z.null()', () => {
      expect(renderType(scalarType('null'))).toBe('z.null()');
    });

    it('renders z.record for object', () => {
      expect(renderType(scalarType('object'))).toBe('z.record(z.string(), z.unknown())');
    });

    it('renders Buffer custom validator for binary', () => {
      const result = renderType(scalarType('binary'));
      expect(result).toContain('z.custom<Buffer>');
      expect(result).toContain('Buffer.isBuffer');
    });
  });

  // ─── Compound types ─────────────────────────────────────────────

  describe('compound types', () => {
    it('renders array type', () => {
      expect(renderType(arrayType(scalarType('string')))).toBe('z.array(z.string())');
    });

    it('renders array with constraints', () => {
      expect(renderType(arrayType(scalarType('string'), { min: 1, max: 10 })))
        .toBe('z.array(z.string()).min(1).max(10)');
    });

    it('renders tuple type', () => {
      expect(renderType(tupleType(scalarType('number'), scalarType('string'))))
        .toBe('z.tuple([z.number(), z.string()])');
    });

    it('renders record type', () => {
      expect(renderType(recordType(scalarType('string'), scalarType('number'))))
        .toBe('z.record(z.string(), z.number())');
    });

    it('renders enum type', () => {
      expect(renderType(enumType('a', 'b', 'c'))).toBe('z.enum(["a", "b", "c"])');
    });

    it('renders literal string', () => {
      expect(renderType(literalType('hello'))).toBe('z.literal("hello")');
    });

    it('renders literal string with quotes escaped', () => {
      expect(renderType(literalType('say "hi"'))).toBe('z.literal("say \\"hi\\"")');
    });

    it('renders literal number', () => {
      expect(renderType(literalType(42))).toBe('z.literal(42)');
    });

    it('renders literal boolean', () => {
      expect(renderType(literalType(true))).toBe('z.literal(true)');
    });

    it('renders union type', () => {
      expect(renderType(unionType(scalarType('string'), scalarType('number'))))
        .toBe('z.union([z.string(), z.number()])');
    });

    it('renders model reference as bare name', () => {
      expect(renderType(refType('User'))).toBe('User');
    });

    it('renders lazy type', () => {
      expect(renderType(lazyType(refType('TreeNode')))).toBe('z.lazy(() => TreeNode)');
    });

    it('renders inline object type', () => {
      const result = renderType(inlineObjectType([
        field('key', scalarType('string')),
        field('value', scalarType('number')),
      ]));
      expect(result).toContain('z.strictObject({');
      expect(result).toContain('key: z.string(),');
      expect(result).toContain('value: z.number(),');
    });
  });
});

describe('generateDto', () => {
  // ─── Simple model ──────────────────────────────────────────────

  describe('simple model', () => {
    it('generates z.strictObject with fields', () => {
      const root = dtoRoot([
        model('User', [
          field('name', scalarType('string')),
          field('age', scalarType('number')),
        ]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('export const User = z.strictObject({');
      expect(output).toContain('name: z.string(),');
      expect(output).toContain('age: z.number(),');
      expect(output).toContain('export type User = z.infer<typeof User>;');
    });

    it('includes zod import', () => {
      const root = dtoRoot([model('M', [field('f', scalarType('string'))])]);
      const output = generateDto(root);
      expect(output).toContain("import { z } from 'zod';");
    });

    it('includes luxon import when DateTime fields exist', () => {
      const root = dtoRoot([model('M', [field('d', scalarType('date'))])]);
      const output = generateDto(root);
      expect(output).toContain("import { DateTime } from 'luxon';");
    });

    it('omits luxon import when no DateTime fields', () => {
      const root = dtoRoot([model('M', [field('f', scalarType('string'))])]);
      const output = generateDto(root);
      expect(output).not.toContain('luxon');
    });

    it('detects DateTime in nested array types', () => {
      const root = dtoRoot([model('M', [field('d', arrayType(scalarType('datetime')))])]);
      const output = generateDto(root);
      expect(output).toContain("import { DateTime } from 'luxon';");
    });
  });

  // ─── Field rendering ───────────────────────────────────────────

  describe('field rendering', () => {
    it('renders nullable field with .nullable()', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { nullable: true })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.nullable()');
    });

    it('renders optional field with .optional()', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { optional: true })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.optional()');
    });

    it('renders default string value with .default()', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { default: 'user' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.default("user")');
    });

    it('renders default number value with .default()', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('number'), { default: 0 })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.default(0)');
    });

    it('renders description with .describe()', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { description: 'A name' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.describe("A name")');
    });

    it('escapes quotes in default string values', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { default: 'he said "hello"' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.default("he said \\"hello\\"")');
    });

    it('escapes backslashes in default string values', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { default: 'path\\to\\file' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.default("path\\\\to\\\\file")');
    });

    it('escapes quotes in field descriptions', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { description: 'A "quoted" desc' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.describe("A \\"quoted\\" desc")');
    });

    it('escapes newlines in field descriptions', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('string'), { description: 'line1\nline2' })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.describe("line1\\nline2")');
    });

    it('prefers .default() over .optional() when default is set', () => {
      const root = dtoRoot([
        model('M', [field('f', scalarType('boolean'), { optional: true, default: true })]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('.default(true)');
      // .optional() should not appear for this field since default is set
      const fieldLine = output.split('\n').find(l => l.includes('f:'))!;
      expect(fieldLine).not.toContain('.optional()');
    });
  });

  // ─── Three-schema pattern (visibility) ─────────────────────────

  describe('three-schema pattern', () => {
    it('generates Base, Read, and Write schemas when visibility fields exist', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
          field('password', scalarType('string'), { visibility: 'writeonly' }),
        ]),
      ]);
      const output = generateDto(root);
      expect(output).toContain('const UserBase = z.strictObject({');
      expect(output).toContain('export const User = z.strictObject({');
      expect(output).toContain('export const UserInput = z.strictObject({');
      expect(output).toContain('export type User = z.infer<typeof User>;');
      expect(output).toContain('export type UserInput = z.infer<typeof UserInput>;');
    });

    it('read schema omits writeonly fields', () => {
      const root = dtoRoot([
        model('User', [
          field('name', scalarType('string')),
          field('password', scalarType('string'), { visibility: 'writeonly' }),
        ]),
      ]);
      const output = generateDto(root);
      // Find the exported User (read) schema section
      const userSection = output.split('export const User =')[1]!.split('});')[0]!;
      expect(userSection).toContain('name:');
      expect(userSection).not.toContain('password:');
    });

    it('write schema omits readonly fields', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
        ]),
      ]);
      const output = generateDto(root);
      // Find the UserInput (write) schema section
      const inputSection = output.split('export const UserInput =')[1]!.split('});')[0]!;
      expect(inputSection).toContain('name:');
      expect(inputSection).not.toContain('id:');
    });
  });

  // ─── Inheritance ───────────────────────────────────────────────

  describe('inheritance', () => {
    it('generates .extend() for models with a base', () => {
      const root = dtoRoot([
        model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
      ]);
      const output = generateDto(root);
      expect(output).toContain('User.extend({');
    });
  });

  // ─── Description ──────────────────────────────────────────────

  describe('model description', () => {
    it('generates JSDoc comment for model description', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))], { description: 'A user' }),
      ]);
      const output = generateDto(root);
      expect(output).toContain('* A user');
    });
  });

  // ─── Source line comments ──────────────────────────────────────

  describe('source line comments', () => {
    it('includes source location comment above schema', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))], { loc: { file: 'user.dto', line: 5 } }),
      ]);
      const output = generateDto(root);
      expect(output).toContain('file://user.dto#L5');
    });

    it('includes source location for three-schema models', () => {
      const root = dtoRoot([
        model('User', [
          field('id', scalarType('uuid'), { visibility: 'readonly' }),
          field('name', scalarType('string')),
        ], { loc: { file: 'user.dto', line: 1 } }),
      ]);
      const output = generateDto(root);
      expect(output).toContain('file://user.dto#L1');
    });
  });

  // ─── Model reference imports ──────────────────────────────────

  describe('model reference imports', () => {
    it('imports externally referenced model types', () => {
      const root = dtoRoot([
        model('Counterparty', [
          field('accounts', arrayType(refType('CounterpartyAccount'))),
        ]),
      ]);
      const output = generateDto(root);
      expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
    });

    it('does not import locally defined models', () => {
      const root = dtoRoot([
        model('CustomCurrency', [field('code', scalarType('string'))]),
        model('LedgerAccount', [
          field('currency', refType('CustomCurrency')),
        ]),
      ]);
      const output = generateDto(root);
      expect(output).not.toContain("import { CustomCurrency }");
    });

    it('imports base model when inherited from external', () => {
      const root = dtoRoot([
        model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
      ]);
      const output = generateDto(root);
      expect(output).toContain("import { User } from './user.js';");
    });

    it('does not import base model when defined locally', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))]),
        model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
      ]);
      const output = generateDto(root);
      expect(output).not.toContain("import { User }");
    });

    it('emits no model imports when all refs are local', () => {
      const root = dtoRoot([
        model('User', [field('name', scalarType('string'))]),
      ]);
      const output = generateDto(root);
      const importLines = output.split('\n').filter(l => l.startsWith('import'));
      expect(importLines).toHaveLength(1); // only zod
    });
  });

  // ─── Cross-directory import resolution ──────────────────────────

  describe('cross-directory import resolution', () => {
    it('generates correct relative path for ref in a different directory', () => {
      const root = dtoRoot([
        model('Counterparty', [
          field('accounts', arrayType(refType('CounterpartyAccount'))),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/modules/transfers/counterparty.ts',
        modelOutPaths: new Map([
          ['CounterpartyAccount', '/out/modules/transfers/counterparty.account.ts'],
        ]),
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
    });

    it('generates ../ path when ref is in a parent directory', () => {
      const root = dtoRoot([
        model('Invoice', [
          field('pagination', refType('Pagination')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/modules/billing/invoice.ts',
        modelOutPaths: new Map([
          ['Pagination', '/out/shared/pagination.ts'],
        ]),
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { Pagination } from '../../shared/pagination.js';");
    });

    it('generates nested ../ path for deeply separated files', () => {
      const root = dtoRoot([
        model('Transfer', [
          field('account', refType('LedgerAccount')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/modules/transfers/types/transfer.ts',
        modelOutPaths: new Map([
          ['LedgerAccount', '/out/modules/ledger/types/ledger.account.ts'],
        ]),
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { LedgerAccount } from '../../ledger/types/ledger.account.js';");
    });

    it('generates subdirectory path when ref is in a child directory', () => {
      const root = dtoRoot([
        model('Dashboard', [
          field('user', refType('User')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/dashboard.ts',
        modelOutPaths: new Map([
          ['User', '/out/users/user.ts'],
        ]),
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { User } from './users/user.js';");
    });

    it('falls back to pascalToDotCase when ref is not in modelOutPaths', () => {
      const root = dtoRoot([
        model('Order', [
          field('item', refType('UnknownExternal')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/order.ts',
        modelOutPaths: new Map(), // empty — ref not found
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { UnknownExternal } from './unknown.external.js';");
    });

    it('falls back to pascalToDotCase when no context is provided', () => {
      const root = dtoRoot([
        model('Counterparty', [
          field('accounts', arrayType(refType('CounterpartyAccount'))),
        ]),
      ]);
      const output = generateDto(root); // no context
      expect(output).toContain("import { CounterpartyAccount } from './counterparty.account.js';");
    });

    it('resolves multiple refs to different directories', () => {
      const root = dtoRoot([
        model('Transfer', [
          field('from', refType('Counterparty')),
          field('pagination', refType('Pagination')),
        ]),
      ]);
      const context: DtoCodegenContext = {
        currentOutPath: '/out/modules/transfers/transfer.ts',
        modelOutPaths: new Map([
          ['Counterparty', '/out/modules/transfers/counterparty.ts'],
          ['Pagination', '/out/shared/pagination.ts'],
        ]),
      };
      const output = generateDto(root, context);
      expect(output).toContain("import { Counterparty } from './counterparty.js';");
      expect(output).toContain("import { Pagination } from '../../shared/pagination.js';");
    });
  });
});
