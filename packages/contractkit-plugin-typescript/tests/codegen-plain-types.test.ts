import { describe, it, expect } from 'vitest';
import { generatePlainTypes } from '../src/codegen-plain-types.js';
import type { ContractCodegenContext } from '@maroonedsoftware/contractkit';
import {
    scalarType,
    arrayType,
    tupleType,
    recordType,
    enumType,
    literalType,
    unionType,
    discriminatedUnionType,
    refType,
    lazyType,
    inlineObjectType,
    field,
    model,
    contractRoot,
} from './helpers.js';

describe('generatePlainTypes', () => {
    // ─── Simple model ──────────────────────────────────────────────

    describe('simple model', () => {
        it('generates interface with fields', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string')), field('age', scalarType('number'))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface User {');
            expect(output).toContain('name: string;');
            expect(output).toContain('age: number;');
        });

        it('does not contain Zod imports or references', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))])]);
            const output = generatePlainTypes(root);
            expect(output).not.toContain('zod');
            expect(output).not.toContain('z.');
            expect(output).not.toContain('z.infer');
        });

        it('does not contain luxon imports for date fields', () => {
            const root = contractRoot([model('Event', [field('startDate', scalarType('date')), field('endDate', scalarType('datetime'))])]);
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
            const root = contractRoot([
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
            const root = contractRoot([model('M', [field('n', scalarType('number')), field('i', scalarType('int')), field('b', scalarType('bigint'))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('n: number;');
            expect(output).toContain('i: number;');
            expect(output).toContain('b: bigint;');
        });

        it('maps boolean type', () => {
            const root = contractRoot([model('M', [field('active', scalarType('boolean'))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('active: boolean;');
        });

        it('maps special types correctly', () => {
            const root = contractRoot([
                model('M', [
                    field('u', scalarType('unknown')),
                    field('n', scalarType('null')),
                    field('o', scalarType('object')),
                    field('bin', scalarType('binary')),
                ]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('u: unknown;');
            expect(output).toContain('n: null;');
            expect(output).toContain('o: Record<string, unknown>;');
            expect(output).toContain('bin: Blob;');
        });
    });

    // ─── Compound types ───────────────────────────────────────────

    describe('compound types', () => {
        it('renders array type', () => {
            const root = contractRoot([model('M', [field('items', arrayType(scalarType('string')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('items: string[];');
        });

        it('renders array of refs', () => {
            const root = contractRoot([model('M', [field('users', arrayType(refType('User')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('users: User[];');
        });

        it('wraps union item in parens when used as array element type', () => {
            const root = contractRoot([model('M', [field('statuses', arrayType(enumType('pending', 'posted', 'archived')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain("statuses: ('pending' | 'posted' | 'archived')[];");
        });

        it('wraps union item in parens for array of union type', () => {
            const root = contractRoot([model('M', [field('items', arrayType(unionType(scalarType('string'), scalarType('int'))))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('items: (string | number)[];');
        });

        it('renders tuple type', () => {
            const root = contractRoot([model('M', [field('pair', tupleType(scalarType('number'), scalarType('string')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('pair: [number, string];');
        });

        it('renders record type', () => {
            const root = contractRoot([model('M', [field('data', recordType(scalarType('string'), scalarType('number')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('data: Record<string, number>;');
        });

        it('renders enum type as union of literals', () => {
            const root = contractRoot([model('M', [field('role', enumType('admin', 'user', 'guest'))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain("role: 'admin' | 'user' | 'guest';");
        });

        it('renders literal types', () => {
            const root = contractRoot([
                model('M', [field('kind', literalType('message')), field('count', literalType(42)), field('flag', literalType(true))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain("kind: 'message';");
            expect(output).toContain('count: 42;');
            expect(output).toContain('flag: true;');
        });

        it('renders union type', () => {
            const root = contractRoot([model('M', [field('value', unionType(scalarType('string'), scalarType('number')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('value: string | number;');
        });

        it('renders discriminated union as a plain TS union (TS narrows on the discriminator)', () => {
            const root = contractRoot([model('M', [field('method', discriminatedUnionType('kind', refType('Card'), refType('Bank')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('method: Card | Bank;');
        });

        it('renders model reference as type name', () => {
            const root = contractRoot([model('M', [field('user', refType('User'))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('user: User;');
        });

        it('renders lazy type transparently', () => {
            const root = contractRoot([model('TreeNode', [field('children', arrayType(lazyType(refType('TreeNode'))))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('children: TreeNode[];');
        });

        it('renders inline object type', () => {
            const root = contractRoot([
                model('M', [field('data', inlineObjectType([field('key', scalarType('string')), field('value', scalarType('number'))]))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('data: { key: string; value: number };');
        });
    });

    // ─── Field modifiers ──────────────────────────────────────────

    describe('field modifiers', () => {
        it('renders optional field with ?', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { optional: true })])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('f?: string;');
        });

        it('renders nullable field with | null', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { nullable: true })])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('f: string | null;');
        });

        it('renders field with default as optional', () => {
            const root = contractRoot([model('M', [field('active', scalarType('boolean'), { default: true })])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('active?: boolean;');
        });

        it('renders nullable + optional field', () => {
            const root = contractRoot([model('M', [field('f', scalarType('string'), { optional: true, nullable: true })])]);
            const output = generatePlainTypes(root);
            expect(output).toContain('f?: string | null;');
        });
    });

    // ─── Type alias ────────────────────────────────────────────────

    describe('type alias', () => {
        it('generates type alias for type-only models', () => {
            const root = contractRoot([model('Currency', [], { type: scalarType('string') })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export type Currency = string;');
            expect(output).not.toContain('interface');
        });

        it('generates type alias for complex types', () => {
            const root = contractRoot([model('UserIds', [], { type: arrayType(scalarType('uuid')) })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export type UserIds = string[];');
        });
    });

    // ─── Visibility (read/write) ──────────────────────────────────

    describe('visibility pattern', () => {
        it('generates read and write interfaces for models with visibility', () => {
            const root = contractRoot([
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
            const root = contractRoot([
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
            const root = contractRoot([
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

    // ─── Transitive Input variants ─────────────────────────────────

    describe('transitive Input variants', () => {
        it('generates Input interface for model that references a visibility model (local)', () => {
            const root = contractRoot([
                model('Entry', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('amount', scalarType('bigint'))]),
                model('Transaction', [field('entries', arrayType(refType('Entry')))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface TransactionInput {');
        });

        it('write interface of parent uses Input variant of referenced child', () => {
            const root = contractRoot([
                model('Entry', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('amount', scalarType('bigint'))]),
                model('Transaction', [field('entries', arrayType(refType('Entry')))]),
            ]);
            const output = generatePlainTypes(root);
            const inputSection = output.split('export interface TransactionInput {')[1]!.split('}')[0]!;
            expect(inputSection).toContain('EntryInput');
            expect(inputSection).not.toContain('Entry[]');
        });

        it('handles multi-level transitive chain', () => {
            const root = contractRoot([
                model('Leaf', [field('id', scalarType('uuid'), { visibility: 'readonly' })]),
                model('Middle', [field('leaf', refType('Leaf'))]),
                model('Top', [field('middle', refType('Middle'))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface MiddleInput {');
            expect(output).toContain('export interface TopInput {');
            const middleInputSection = output.split('export interface MiddleInput {')[1]!.split('}')[0]!;
            expect(middleInputSection).toContain('LeafInput');
            const topInputSection = output.split('export interface TopInput {')[1]!.split('}')[0]!;
            expect(topInputSection).toContain('MiddleInput');
        });

        it('handles transitive ref from external context', () => {
            const root = contractRoot([model('Transaction', [field('entries', arrayType(refType('ExternalEntry')))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/transaction.ts',
                modelOutPaths: new Map([
                    ['ExternalEntry', '/out/entry.ts'],
                    ['ExternalEntryInput', '/out/entry.ts'],
                ]),
                modelsWithInput: new Set(['ExternalEntry']),
            };
            const output = generatePlainTypes(root, context);
            expect(output).toContain('export interface TransactionInput {');
            const inputSection = output.split('export interface TransactionInput {')[1]!.split('}')[0]!;
            expect(inputSection).toContain('ExternalEntryInput');
            expect(output).toContain("import type { ExternalEntryInput } from './entry.js';");
        });

        it('model without visibility that only refs plain models stays simple', () => {
            const root = contractRoot([
                model('PlainChild', [field('name', scalarType('string'))]),
                model('Parent', [field('child', refType('PlainChild'))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).not.toContain('ParentInput');
            expect(output).not.toContain('PlainChildInput');
        });
    });

    // ─── Inheritance ──────────────────────────────────────────────

    describe('inheritance', () => {
        it('generates extends clause for models with a base', () => {
            const root = contractRoot([model('Admin', [field('role', scalarType('string'))], { base: 'User' })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface Admin extends User {');
        });

        it('generates extends for visibility model with base (base has no Input variant)', () => {
            const root = contractRoot([
                model('Admin', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('role', scalarType('string'))], { base: 'User' }),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface Admin extends User {');
            // User not in modelsWithInput — AdminInput extends User (not UserInput)
            expect(output).toContain('export interface AdminInput extends User {');
        });

        it('generates extends for visibility model with base (base has Input variant)', () => {
            const root = contractRoot([
                model('Admin', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('role', scalarType('string'))], { base: 'User' }),
            ]);
            const output = generatePlainTypes(root, {
                modelsWithInput: new Set(['User']),
                currentOutPath: '/out/admin.ts',
                modelOutPaths: new Map(),
            });
            expect(output).toContain('export interface Admin extends User {');
            // User is in modelsWithInput — AdminInput extends UserInput
            expect(output).toContain('export interface AdminInput extends UserInput {');
        });

        it('child extends parent in same file both get Input when parent has visibility', () => {
            const root = contractRoot([
                model('User', [field('id', scalarType('uuid'), { visibility: 'readonly' }), field('name', scalarType('string'))]),
                model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
            ]);
            const output = generatePlainTypes(root);
            // User has visibility fields → needs Input; Admin extends User → also needs Input
            expect(output).toContain('export interface User {');
            expect(output).toContain('export interface UserInput {');
            expect(output).toContain('export interface Admin extends User {');
            expect(output).toContain('export interface AdminInput extends UserInput {');
        });
    });

    // ─── Type alias Input variants ────────────────────────────────

    describe('type alias Input variants', () => {
        it('type alias referencing model with Input variant gets its own Input variant', () => {
            const root = contractRoot([
                model('Pagination', [field('page', scalarType('int')), field('total', scalarType('int'), { visibility: 'readonly' })]),
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'inlineObject', fields: [field('status', scalarType('string'), { optional: true })] },
                        ],
                    },
                }),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export type ListQuery = Pagination & {');
            expect(output).toContain('export type ListQueryInput = PaginationInput & {');
        });

        it('imports PaginationInput when type alias references external Pagination with Input variant', () => {
            const root = contractRoot([
                model('ListQuery', [], {
                    type: {
                        kind: 'intersection',
                        members: [
                            { kind: 'ref', name: 'Pagination' },
                            { kind: 'inlineObject', fields: [field('status', scalarType('string'), { optional: true })] },
                        ],
                    },
                }),
            ]);
            const output = generatePlainTypes(root, {
                modelsWithInput: new Set(['Pagination']),
                currentOutPath: '/out/list.query.ts',
                modelOutPaths: new Map([
                    ['Pagination', '/out/pagination.ts'],
                    ['PaginationInput', '/out/pagination.ts'],
                ]),
            });
            expect(output).toContain("import type { Pagination } from './pagination.js';");
            expect(output).toContain("import type { PaginationInput } from './pagination.js';");
            expect(output).toContain('export type ListQueryInput = PaginationInput & {');
        });

        it('type alias NOT referencing any model with Input stays simple', () => {
            const root = contractRoot([model('UserId', [], { type: { kind: 'scalar', name: 'uuid' } })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export type UserId =');
            expect(output).not.toContain('UserIdInput');
        });
    });

    // ─── JSDoc comments ───────────────────────────────────────────

    describe('comments', () => {
        it('includes model description in JSDoc', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))], { description: 'A system user' })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('* A system user');
        });

        it('includes source location in JSDoc', () => {
            const root = contractRoot([model('User', [field('name', scalarType('string'))], { loc: { file: 'user.ck', line: 5 } })]);
            const output = generatePlainTypes(root);
            expect(output).toContain('file://./user.ck#L5');
        });
    });

    // ─── Import resolution ─────────────────────────────────────────

    describe('import resolution', () => {
        it('uses type-only imports for external references', () => {
            const root = contractRoot([model('Counterparty', [field('accounts', arrayType(refType('CounterpartyAccount')))])]);
            const output = generatePlainTypes(root);
            expect(output).toContain("import type { CounterpartyAccount } from './counterparty.account.js';");
        });

        it('does not import locally defined models', () => {
            const root = contractRoot([
                model('Currency', [field('code', scalarType('string'))]),
                model('Account', [field('currency', refType('Currency'))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).not.toContain('import type { Currency }');
        });

        it('resolves imports using modelOutPaths context', () => {
            const root = contractRoot([model('Transfer', [field('account', refType('LedgerAccount'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/modules/transfers/transfer.ts',
                modelOutPaths: new Map([['LedgerAccount', '/out/modules/ledger/ledger.account.ts']]),
            };
            const output = generatePlainTypes(root, context);
            expect(output).toContain("import type { LedgerAccount } from '../ledger/ledger.account.js';");
        });

        it('falls back to pascalToDotCase when ref not in modelOutPaths', () => {
            const root = contractRoot([model('Order', [field('item', refType('UnknownExternal'))])]);
            const context: ContractCodegenContext = {
                currentOutPath: '/out/order.ts',
                modelOutPaths: new Map(),
            };
            const output = generatePlainTypes(root, context);
            expect(output).toContain("import type { UnknownExternal } from './unknown.external.js';");
        });

        it('imports base model when inherited from external', () => {
            const root = contractRoot([model('Admin', [field('role', scalarType('string'))], { base: 'User' })]);
            const output = generatePlainTypes(root);
            expect(output).toContain("import type { User } from './user.js';");
        });
    });

    // ─── Topological sorting ───────────────────────────────────────

    describe('topological sorting', () => {
        it('emits dependencies before dependents', () => {
            const root = contractRoot([model('B', [field('a', refType('A'))]), model('A', [field('name', scalarType('string'))])]);
            const output = generatePlainTypes(root);
            const aIndex = output.indexOf('export interface A {');
            const bIndex = output.indexOf('export interface B {');
            expect(aIndex).toBeLessThan(bIndex);
        });
    });

    // ─── Multiple models ───────────────────────────────────────────

    describe('multiple models', () => {
        it('generates all models in one output', () => {
            const root = contractRoot([
                model('User', [field('id', scalarType('uuid')), field('name', scalarType('string'))]),
                model('Post', [field('id', scalarType('uuid')), field('title', scalarType('string')), field('author', refType('User'))]),
            ]);
            const output = generatePlainTypes(root);
            expect(output).toContain('export interface User {');
            expect(output).toContain('export interface Post {');
            expect(output).toContain('author: User;');
            // No import for User since it's local
            expect(output).not.toContain('import type { User }');
        });
    });
});

describe('field name quoting', () => {
    it('quotes hyphenated field names in interfaces', () => {
        const root = contractRoot([
            model('WebhookHeaders', [
                field('x-topic', scalarType('string')),
                field('x-event-id', scalarType('string')),
                field('normalField', scalarType('string')),
            ]),
        ]);
        const output = generatePlainTypes(root);
        expect(output).toContain("'x-topic': string;");
        expect(output).toContain("'x-event-id': string;");
        expect(output).toContain('normalField: string;');
    });

    it('quotes hyphenated optional fields correctly', () => {
        const root = contractRoot([model('Headers', [field('x-request-id', scalarType('string'), { optional: true })])]);
        const output = generatePlainTypes(root);
        expect(output).toContain("'x-request-id'?: string;");
    });
});
