import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../src/codegen-markdown.js';
import {
    scalarType, arrayType, enumType, refType, unionType,
    recordType, literalType, inlineObjectType,
    field, model, dtoRoot,
    opParam, opRequest, opResponse,
    opOperation, opRoute, opRoot,
} from './helpers.js';
import type { IntersectionTypeNode, DtoTypeNode } from '../src/ast.js';

function intersectionType(...members: DtoTypeNode[]): IntersectionTypeNode {
    return { kind: 'intersection', members };
}

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

        it('lists endpoints in TOC with verb-based titles', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', { description: 'List all users' }),
                    opOperation('post', { description: 'Create a user' }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('[List all users]');
            expect(output).toContain('[Create a user]');
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

    // ─── Area grouping ──────────────────────────────────────────

    describe('area grouping', () => {
        it('renders area heading for endpoints', () => {
            const op = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### Ledger');
        });

        it('uses #### for grouped endpoint titles', () => {
            const op = opRoot(
                [opRoute('/ledger/accounts', [opOperation('get')])],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('#### List ledger accounts');
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
            expect(output).toContain('### List users');
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
            const healthPos = output.indexOf('List health');
            const ledgerPos = output.indexOf('### Ledger');
            expect(healthPos).toBeLessThan(ledgerPos);
        });
    });

    // ─── Title derivation ───────────────────────────────────────

    describe('title derivation', () => {
        it('uses op.description as title', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get', { description: 'list all users' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### List all users');
        });

        it('derives title from service method name', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('post', { service: 'UserService.createUser' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### Create user');
        });

        it('falls back to method + path', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### List users');
        });

        it('falls back for delete to Delete verb', () => {
            const op = opRoot([
                opRoute('/users/:id', [opOperation('delete')], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### Delete users');
        });

        it('strips path params from fallback title', () => {
            const op = opRoot([
                opRoute('/users/:id/posts', [opOperation('get')], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('### List users posts');
        });
    });

    // ─── Method + path code block ───────────────────────────────

    describe('method and path code block', () => {
        it('renders method and path in plaintext code block', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('```plaintext\nGET /users\n```');
        });

        it('uppercases the method', () => {
            const op = opRoot([opRoute('/users', [opOperation('post')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('POST /users');
        });
    });

    // ─── Endpoint rendering ──────────────────────────────────────

    describe('endpoints', () => {
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
    });

    // ─── Unified attributes table ───────────────────────────────

    describe('unified attributes table', () => {
        it('renders path params in attributes table', () => {
            const op = opRoot([
                opRoute('/users/:userId', [opOperation('get')], [
                    opParam('userId', scalarType('uuid')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('#### Attributes');
            expect(output).toContain('| `userId` | `string` | Yes | Path parameter. |');
        });

        it('renders query params in same attributes table', () => {
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
            expect(output).toContain('| `page` | `number` | Yes |');
            expect(output).toContain('| `limit` | `number` | Yes |');
        });

        it('merges path and query params in one table', () => {
            const op = opRoot([
                opRoute('/users/:id/posts', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int'))],
                    }),
                ], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            // Should have exactly one Attributes heading and table
            const attrCount = output.match(/Attributes\n/g)?.length ?? 0;
            expect(attrCount).toBe(1);
            expect(output).toContain('| `id` | `string` | Yes | Path parameter. |');
            expect(output).toContain('| `page` | `number` | Yes |');
        });

        it('sorts path params before query params', () => {
            const op = opRoot([
                opRoute('/users/:id', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int'))],
                    }),
                ], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            const idPos = output.indexOf('`id`');
            const pagePos = output.indexOf('`page`');
            expect(idPos).toBeLessThan(pagePos);
        });

        it('resolves string query reference to model fields', () => {
            const dto = dtoRoot([
                model('Pagination', [
                    field('page', scalarType('int'), { description: 'Page number' }),
                    field('limit', scalarType('int'), { optional: true, description: 'Items per page' }),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [opOperation('get', { query: 'Pagination' })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes | Page number |');
            expect(output).toContain('| `limit` | `number` | No | Items per page |');
        });

        it('resolves ref query type to model fields', () => {
            const dto = dtoRoot([
                model('Pagination', [
                    field('page', scalarType('int')),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [opOperation('get', { query: refType('Pagination') })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes |');
        });

        it('resolves intersection query to flattened fields', () => {
            const dto = dtoRoot([
                model('Pagination', [
                    field('page', scalarType('int'), { description: 'Page number' }),
                ]),
            ]);
            const query = intersectionType(
                refType('Pagination'),
                inlineObjectType([
                    field('status', enumType('active', 'inactive'), { optional: true }),
                ]),
            );
            const op = opRoot([
                opRoute('/users', [opOperation('get', { query })]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes | Page number |');
            expect(output).toContain('| `status` |');
        });

        it('omits Attributes section when no params', () => {
            const op = opRoot([opRoute('/health', [opOperation('get')])]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).not.toContain('Attributes');
        });
    });

    // ─── Request body ───────────────────────────────────────────

    describe('request body', () => {
        it('renders request body subheading with content type', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('CreateUser') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('Request body');
            expect(output).toContain('Content type: `application/json`');
        });

        it('shows type link for ref body', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('CreateUser') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('[CreateUser](#createuser)');
        });

        it('expands ref body into fields table', () => {
            const dto = dtoRoot([
                model('CreateUser', [
                    field('name', scalarType('string'), { description: 'The user name' }),
                    field('email', scalarType('email'), { description: 'The user email' }),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('CreateUser') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `name` | `string` | Yes | The user name |');
            expect(output).toContain('| `email` | `string` | Yes | The user email |');
        });

        it('excludes readonly fields from request body', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly', description: 'Auto-generated' }),
                    field('name', scalarType('string'), { description: 'The user name' }),
                    field('createdAt', scalarType('datetime'), { visibility: 'readonly' }),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('User'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            // Should include writable field
            expect(output).toContain('| `name` | `string` | Yes | The user name |');
            // Find the request body section specifically (between Request body and Response)
            const reqBodyIdx = output.indexOf('Request body');
            const responseIdx = output.indexOf('Response', reqBodyIdx + 12);
            const reqBodySection = output.slice(reqBodyIdx, responseIdx);
            expect(reqBodySection).not.toContain('`id`');
            expect(reqBodySection).not.toContain('`createdAt`');
            // But response DOES include readonly fields
            const respSection = output.slice(responseIdx);
            expect(respSection).toContain('`id`');
            expect(respSection).toContain('`createdAt`');
        });

        it('falls back to type link when model not resolvable', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('UnknownType') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('[UnknownType](#unknowntype)');
        });
    });

    // ─── Response rendering ─────────────────────────────────────

    describe('responses', () => {
        it('renders response subheading', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('Response');
        });

        it('renders status code with text', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('Status: `200 OK`');
        });

        it('renders 204 no content without body', () => {
            const op = opRoot([
                opRoute('/users/:id', [
                    opOperation('delete', { responses: [opResponse(204)] }),
                ], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('Status: `204 No Content`');
        });

        it('renders 201 Created status text', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('Status: `201 Created`');
        });

        it('expands response body into fields table', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly', description: 'The user ID' }),
                    field('name', scalarType('string'), { description: 'The user name' }),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `id` | `string` | Yes | The user ID. *read-only* |');
            expect(output).toContain('| `name` | `string` | Yes | The user name |');
        });

        it('includes readonly fields in response body', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('name', scalarType('string')),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            // Response should include readonly fields
            const respIdx = output.indexOf('Response');
            const respSection = output.slice(respIdx);
            expect(respSection).toContain('`id`');
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

        it('renders model description as plain text', () => {
            const dto = dtoRoot([
                model('User', [field('id', scalarType('uuid'))], { description: 'A user object' }),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('A user object');
            // Should NOT be a blockquote
            expect(output).not.toContain('> A user object');
        });

        it('renders extends link for base model', () => {
            const dto = dtoRoot([
                model('Admin', [field('role', scalarType('string'))], { base: 'User' }),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('Extends [`User`](#user)');
        });

        it('uses Attribute column header', () => {
            const dto = dtoRoot([
                model('User', [field('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('| Attribute | Type | Required | Description |');
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
            expect(output).toContain('GET /users');
            expect(output).toContain('GET /orders');
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
            const matches = output.match(/### Ledger/g);
            expect(matches).toHaveLength(1);
            expect(output).toContain('GET /ledger/accounts');
            expect(output).toContain('GET /ledger/transactions');
        });
    });

    // ─── No horizontal rules ────────────────────────────────────

    describe('formatting', () => {
        it('does not render horizontal rules between endpoints', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get'), opOperation('post')]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            // The only --- should be in the TOC separator
            const endpointsSection = output.slice(output.indexOf('## Endpoints'));
            expect(endpointsSection).not.toContain('\n---\n');
        });

        it('escapes pipe characters in enum types within tables', () => {
            const dto = dtoRoot([
                model('User', [
                    field('status', enumType('active', 'inactive')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            // The pipe in 'active' | 'inactive' must be escaped as \|
            expect(output).toContain("'active' \\| 'inactive'");
            // Should NOT contain unescaped pipe that breaks the table
            expect(output).not.toContain("'active' | 'inactive'");
        });

        it('escapes pipe characters in union types within tables', () => {
            const dto = dtoRoot([
                model('User', [
                    field('value', unionType(scalarType('string'), scalarType('number'))),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('string \\| number');
        });

        it('escapes pipe characters in endpoint attribute types', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('sort', enumType('asc', 'desc'))],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain("'asc' \\| 'desc'");
        });

        it('wraps endpoint attributes table in collapsed details', () => {
            const op = opRoot([
                opRoute('/users/:id', [opOperation('get')], [
                    opParam('id', scalarType('uuid')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [], opRoots: [op] });
            expect(output).toContain('<details>');
            expect(output).toContain('<summary>Attributes (1)</summary>');
            expect(output).toContain('</details>');
        });

        it('wraps request body fields in collapsed details', () => {
            const dto = dtoRoot([
                model('User', [
                    field('name', scalarType('string')),
                    field('email', scalarType('email')),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', { request: opRequest('User') }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('<summary>Attributes (2)</summary>');
        });

        it('wraps response body fields in collapsed details', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid')),
                    field('name', scalarType('string')),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            expect(output).toContain('<summary>Attributes (2)</summary>');
        });

        it('wraps model fields in collapsed details', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid')),
                    field('name', scalarType('string')),
                    field('email', scalarType('email')),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [] });
            expect(output).toContain('<summary>Attributes (3)</summary>');
        });

        it('excludes readonly fields from request body count', () => {
            const dto = dtoRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('name', scalarType('string')),
                ]),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        request: opRequest('User'),
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ dtoRoots: [dto], opRoots: [op] });
            // Request body: only 1 writable field
            const reqIdx = output.indexOf('Request body');
            const respIdx = output.indexOf('Response', reqIdx + 12);
            const reqSection = output.slice(reqIdx, respIdx);
            expect(reqSection).toContain('<summary>Attributes (1)</summary>');
            // Response: both fields
            const respSection = output.slice(respIdx);
            expect(respSection).toContain('<summary>Attributes (2)</summary>');
        });
    });
});
