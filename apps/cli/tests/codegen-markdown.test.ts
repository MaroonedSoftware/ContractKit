import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../src/codegen-markdown.js';
import {
    scalarType, arrayType, enumType, refType, unionType,
    recordType, literalType,
    field, model, dtoRoot,
    opParam, opRequest, opResponse,
    opOperation, opRoute, opRoot,
} from './helpers.js';

describe('generateMarkdown', () => {
    // ─── Basic structure ─────────────────────────────────────────

    describe('document structure', () => {
        it('generates API Reference heading', () => {
            const output = generateMarkdown({ dtoRoots: [], opRoots: [] });
            expect(output).toContain('# API Reference');
        });

        it('includes Endpoints section when ops exist', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('## Endpoints');
        });

        it('includes Models section when dtos exist', () => {
            const dto = dtoRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('## Models');
        });

        it('omits Endpoints section when no ops', () => {
            const output = generateMarkdown({ dtoRoots: [], opRoots: [] });
            expect(output).not.toContain('## Endpoints');
        });

        it('omits Models section when no dtos', () => {
            const output = generateMarkdown({ dtoRoots: [], opRoots: [] });
            expect(output).not.toContain('## Models');
        });

        it('omits Table of Contents when empty', () => {
            const output = generateMarkdown({ dtoRoots: [], opRoots: [] });
            expect(output).not.toContain('## Table of Contents');
        });
    });

    // ─── Table of Contents ──────────────────────────────────────

    describe('table of contents', () => {
        it('renders TOC when endpoints exist', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('## Table of Contents');
            expect(output).toContain('**Endpoints**');
        });

        it('renders TOC when models exist', () => {
            const dto = dtoRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('## Table of Contents');
            expect(output).toContain('**Models**');
        });

        it('lists endpoints in TOC with method and path', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get'), opOperation('post')]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('`GET` /users');
            expect(output).toContain('`POST` /users');
        });

        it('lists models in TOC', () => {
            const dto = dtoRoot([
                model('User', [field('id', scalarType('uuid'))]),
                model('Order', [field('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('- [User](#user)');
            expect(output).toContain('- [Order](#order)');
        });

        it('groups endpoints by area in TOC', () => {
            const op = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('- [Ledger](#ledger)');
        });

        it('groups models by area in TOC', () => {
            const dto = dtoRoot(
                [model('LedgerAccount', [field('id', scalarType('uuid'))])],
                'ledger.dto',
            );
            (dto as any).meta = { area: 'ledger' };
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('- [Ledger](#ledger-models)');
        });
    });

    // ─── Grouping by area ───────────────────────────────────────

    describe('area grouping', () => {
        it('renders area heading for endpoints', () => {
            const op = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### Ledger');
            expect(output).toContain('#### `GET /ledger/accounts`');
        });

        it('renders area heading for models', () => {
            const dto = dtoRoot(
                [model('LedgerAccount', [field('id', scalarType('uuid'))])],
                'ledger.dto',
            );
            (dto as any).meta = { area: 'ledger' };
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('### Ledger');
            expect(output).toContain('#### LedgerAccount');
        });

        it('uses ### for ungrouped endpoints (no area)', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### `GET /users`');
            expect(output).not.toContain('#### `GET /users`');
        });

        it('uses ### for ungrouped models (no area)', () => {
            const dto = dtoRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('### User');
            expect(output).not.toContain('#### User');
        });

        it('groups endpoints from multiple files by area', () => {
            const op1 = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const op2 = opRoot(
                [opRoute('/capital/offers', [opOperation('get')])],
                'capital.op',
                { area: 'capital' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op1, op2] });
            expect(output).toContain('### Ledger');
            expect(output).toContain('### Capital');
        });

        it('places ungrouped endpoints before grouped ones', () => {
            const ungrouped = opRoot([opRoute('/health', [opOperation('get')])]);
            const grouped = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [ungrouped, grouped] });
            const healthPos = output.indexOf('`GET /health`');
            const ledgerPos = output.indexOf('### Ledger');
            expect(healthPos).toBeLessThan(ledgerPos);
        });
    });

    // ─── Endpoint rendering ──────────────────────────────────────

    describe('endpoints', () => {
        it('renders method and path as heading', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### `GET /users`');
        });

        it('renders SDK method name', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**SDK method:** `getUsers`');
        });

        it('uses explicit sdk name when provided', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get', { sdk: 'listAllUsers' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**SDK method:** `listAllUsers`');
        });

        it('derives method name with path params', () => {
            const op = opRoot([
                opRoute('/users/:id', [opOperation('get')], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**SDK method:** `getUsersById`');
        });

        it('renders operation description as blockquote', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get', { description: 'List all users' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('> List all users');
        });

        it('renders path parameters table', () => {
            const op = opRoot([
                opRoute('/users/:userId', [opOperation('get')], [
                    opParam('userId', scalarType('uuid')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**Path parameters:**');
            expect(output).toContain('| `userId` | `string` |');
        });

        it('renders query parameters table', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [
                            opParam('page', scalarType('int')),
                            opParam('limit', scalarType('int')),
                        ],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**Query parameters:**');
            expect(output).toContain('| `page` | `number` |');
            expect(output).toContain('| `limit` | `number` |');
        });

        it('renders type-reference query as link', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get', { query: 'Pagination' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**Query:** [`Pagination`](#pagination)');
        });

        it('renders request body', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('CreateUser') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**Request body** (`application/json`):');
            expect(output).toContain('[CreateUser](#createuser)');
        });

        it('renders responses table', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('**Responses:**');
            expect(output).toContain('| 200 | application/json |');
            expect(output).toContain('[User](#user)');
        });

        it('renders 204 no-body response', () => {
            const op = opRoot([
                opRoute('/users/:id', [
                    opOperation('delete', { responses: [opResponse(204)] }),
                ], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('| 204 | - | - |');
        });

        it('renders array response type with link', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('[User](#user)[]');
        });
    });

    // ─── Model rendering ────────────────────────────────────────

    describe('models', () => {
        it('renders model name as heading', () => {
            const dto = dtoRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('### User');
        });

        it('renders model description as blockquote', () => {
            const dto = dtoRoot([
                model('User', [field('id', scalarType('uuid'))], { description: 'A user object' }),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('> A user object');
        });

        it('renders extends link for base model', () => {
            const dto = dtoRoot([
                model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('Extends [`User`](#user)');
        });

        it('renders fields table with types', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid')),
                    field('name', scalarType('string')),
                    field('email', scalarType('email')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('| Field | Type | Required | Description |');
            expect(output).toContain('| `id` | `string` | Yes |');
            expect(output).toContain('| `name` | `string` | Yes |');
            expect(output).toContain('| `email` | `string` | Yes |');
        });

        it('marks optional fields as not required', () => {
            const dto = dtoRoot([
                model('User', [
                    field('bio', scalarType('string'), { optional: true }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('| `bio` | `string` | No |');
        });

        it('includes visibility modifiers in description', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('password', scalarType('string'), { visibility: 'writeonly' }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('*read-only*');
            expect(output).toContain('*write-only*');
        });

        it('includes default values in description', () => {
            const dto = dtoRoot([
                model('Config', [
                    field('active', scalarType('boolean'), { default: true }),
                    field('pageSize', scalarType('int'), { default: 25 }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('default: `true`');
            expect(output).toContain('default: `25`');
        });

        it('includes field description text', () => {
            const dto = dtoRoot([
                model('User', [
                    field('name', scalarType('string'), { description: 'The user name' }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('The user name');
        });

        it('renders type alias as code block', () => {
            const dto = dtoRoot([
                model('Status', [], { type: enumType('active', 'inactive') }),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain("type Status = 'active' | 'inactive'");
        });

        it('includes nullable modifier', () => {
            const dto = dtoRoot([
                model('User', [
                    field('bio', scalarType('string'), { nullable: true, optional: true }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('*nullable*');
        });
    });

    // ─── Multiple files combined ─────────────────────────────────

    describe('combining multiple files', () => {
        it('merges endpoints from multiple op files', () => {
            const op1 = opRoot([opRoute('/users', [opOperation('get')])]);
            const op2 = opRoot([opRoute('/orders', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op1, op2] });
            expect(output).toContain('`GET /users`');
            expect(output).toContain('`GET /orders`');
        });

        it('merges models from multiple dto files', () => {
            const dto1 = dtoRoot([model('User', [field('id', scalarType('uuid'))])]);
            const dto2 = dtoRoot([model('Order', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ dtoRoots: [dto1, dto2], opRoots: [] });
            expect(output).toContain('### User');
            expect(output).toContain('### Order');
        });

        it('merges endpoints from same area into one group', () => {
            const op1 = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const op2 = opRoot(
                [opRoute('/ledger/transactions', [opOperation('get')])],
                'ledger.transactions.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op1, op2] });
            // Should have exactly one Ledger heading
            const matches = output.match(/### Ledger/g);
            expect(matches).toHaveLength(1);
            expect(output).toContain('`GET /ledger/accounts`');
            expect(output).toContain('`GET /ledger/transactions`');
        });
    });
});
