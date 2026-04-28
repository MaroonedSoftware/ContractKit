import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '../src/codegen-markdown.js';
import {
    scalarType,
    arrayType,
    enumType,
    refType,
    unionType,
    recordType,
    literalType,
    inlineObjectType,
    field,
    model,
    contractRoot,
    opParam,
    opRequest,
    opResponse,
    opOperation,
    opRoute,
    opRoot,
} from './helpers.js';
import type { IntersectionTypeNode, ContractTypeNode } from '@maroonedsoftware/contractkit';

function intersectionType(...members: ContractTypeNode[]): IntersectionTypeNode {
    return { kind: 'intersection', members };
}

describe('generateMarkdown', () => {
    // ─── Basic structure ─────────────────────────────────────────

    describe('document structure', () => {
        it('generates API Reference heading', () => {
            const output = generateMarkdown({ contractRoots: [], opRoots: [] });
            expect(output).toContain('# API Reference');
        });

        it('includes Endpoints section when ops exist', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('## Endpoints');
        });

        it('includes Models section when contracts exist', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('## Models');
        });

        it('omits Endpoints section when no ops', () => {
            const output = generateMarkdown({ contractRoots: [], opRoots: [] });
            expect(output).not.toContain('## Endpoints');
        });

        it('omits Models section when no contracts', () => {
            const output = generateMarkdown({ contractRoots: [], opRoots: [] });
            expect(output).not.toContain('## Models');
        });

        it('omits Table of Contents when empty', () => {
            const output = generateMarkdown({ contractRoots: [], opRoots: [] });
            expect(output).not.toContain('## Table of Contents');
        });
    });

    // ─── Table of Contents ──────────────────────────────────────

    describe('table of contents', () => {
        it('renders TOC when endpoints exist', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('## Table of Contents');
            expect(output).toContain('**Endpoints**');
        });

        it('renders TOC when models exist', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('## Table of Contents');
            expect(output).toContain('**Models**');
        });

        it('lists endpoints in TOC with verb-based titles', () => {
            const op = opRoot([
                opRoute('/users', [opOperation('get', { description: 'List all users' }), opOperation('post', { description: 'Create a user' })]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('[List all users]');
            expect(output).toContain('[Create a user]');
        });

        it('lists models in TOC', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))]), model('Order', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('- [User](#user)');
            expect(output).toContain('- [Order](#order)');
        });

        it('groups endpoints by area in collapsible TOC section', () => {
            const op = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('<summary><strong>Ledger</strong> (1)</summary>');
        });

        it('groups models by area in collapsible TOC section', () => {
            const dto = contractRoot([model('LedgerAccount', [field('id', scalarType('uuid'))])], 'ledger.ck');
            (dto as any).meta = { area: 'ledger' };
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('<summary><strong>Ledger</strong> (1)</summary>');
        });

        it('shows endpoint count per area in TOC', () => {
            const op = opRoot([opRoute('/ledger/accounts', [opOperation('get'), opOperation('post')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('<summary><strong>Ledger</strong> (2)</summary>');
        });

        it('does not wrap ungrouped endpoints in collapsible section', () => {
            const op = opRoot([opRoute('/health', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('- [List health]');
            // Should not have <details> in the TOC for ungrouped items
            const tocSection = output.slice(output.indexOf('**Endpoints**'), output.indexOf('---'));
            expect(tocSection).not.toContain('<details>');
        });
    });

    // ─── Area grouping ──────────────────────────────────────────

    describe('area grouping', () => {
        it('renders area heading for endpoints', () => {
            const op = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Ledger');
        });

        it('uses #### for grouped endpoint titles', () => {
            const op = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('#### List ledger accounts');
        });

        it('renders area heading for models', () => {
            const dto = contractRoot([model('LedgerAccount', [field('id', scalarType('uuid'))])], 'ledger.ck');
            (dto as any).meta = { area: 'ledger' };
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('### Ledger');
            expect(output).toContain('#### LedgerAccount');
        });

        it('uses ### for ungrouped endpoints (no area)', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### List users');
        });

        it('uses ### for ungrouped models (no area)', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('### User');
            expect(output).not.toContain('#### User');
        });

        it('groups endpoints from multiple files by area', () => {
            const op1 = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const op2 = opRoot([opRoute('/capital/offers', [opOperation('get')])], 'capital.op', { area: 'capital' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op1, op2] });
            expect(output).toContain('### Ledger');
            expect(output).toContain('### Capital');
        });

        it('places ungrouped endpoints before grouped ones', () => {
            const ungrouped = opRoot([opRoute('/health', [opOperation('get')])]);
            const grouped = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [ungrouped, grouped] });
            const healthPos = output.indexOf('List health');
            const ledgerPos = output.indexOf('### Ledger');
            expect(healthPos).toBeLessThan(ledgerPos);
        });
    });

    // ─── Title derivation ───────────────────────────────────────

    describe('title derivation', () => {
        it('uses op.description as title', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { description: 'list all users' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### List all users');
        });

        it('normalizes third-person verbs to imperative mood', () => {
            const op = opRoot([opRoute('/accounts', [opOperation('post', { description: 'Creates a new account' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Create a new account');
        });

        it('normalizes "Lists" to "List"', () => {
            const op = opRoot([opRoute('/accounts', [opOperation('get', { description: 'Lists all accounts' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### List all accounts');
        });

        it('normalizes "Finalizes" to "Finalize"', () => {
            const op = opRoot([opRoute('/tx', [opOperation('post', { description: 'Finalizes a transaction' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Finalize a transaction');
        });

        it('preserves words ending in ss (e.g. Process)', () => {
            const op = opRoot([opRoute('/cache', [opOperation('post', { description: 'Process cache queue' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Process cache queue');
        });

        it('derives title from service method name', () => {
            const op = opRoot([opRoute('/users', [opOperation('post', { service: 'UserService.createUser' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Create user');
        });

        it('falls back to method + path', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### List users');
        });

        it('falls back for delete to Delete verb', () => {
            const op = opRoot([opRoute('/users/{id}', [opOperation('delete')], [opParam('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### Delete users');
        });

        it('strips path params from fallback title', () => {
            const op = opRoot([opRoute('/users/{id}/posts', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('### List users posts');
        });
    });

    // ─── Method + path badge ────────────────────────────────────

    describe('method and path badge', () => {
        it('renders method and path as compact badge line', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('**`GET`** `/users`');
        });

        it('uppercases the method', () => {
            const op = opRoot([opRoute('/users', [opOperation('post')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('**`POST`** `/users`');
        });
    });

    // ─── Endpoint rendering ──────────────────────────────────────

    describe('endpoints', () => {
        it('renders SDK method name in GitHub admonition', () => {
            const op = opRoot([opRoute('/users', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('> [!NOTE]');
            expect(output).toContain('> SDK method: `getUsers`');
        });

        it('uses explicit sdk name when provided', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { sdk: 'listAllUsers' })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('> SDK method: `listAllUsers`');
        });

        it('derives method name with path params', () => {
            const op = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('> SDK method: `getUsersById`');
        });
    });

    // ─── Unified attributes table ───────────────────────────────

    describe('unified attributes table', () => {
        it('renders path params in attributes table', () => {
            const op = opRoot([opRoute('/users/{userId}', [opOperation('get')], [opParam('userId', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('#### Attributes');
            expect(output).toContain('| `userId` | `string` | Yes | Path parameter. |');
        });

        it('renders query params in same attributes table', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        query: [opParam('page', scalarType('int')), opParam('limit', scalarType('int'))],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes |');
            expect(output).toContain('| `limit` | `number` | Yes |');
        });

        it('merges path and query params in one table', () => {
            const op = opRoot([
                opRoute(
                    '/users/{id}/posts',
                    [
                        opOperation('get', {
                            query: [opParam('page', scalarType('int'))],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            // Should have exactly one Attributes heading and table
            const attrCount = output.match(/Attributes\n/g)?.length ?? 0;
            expect(attrCount).toBe(1);
            expect(output).toContain('| `id` | `string` | Yes | Path parameter. |');
            expect(output).toContain('| `page` | `number` | Yes |');
        });

        it('sorts path params before query params', () => {
            const op = opRoot([
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            query: [opParam('page', scalarType('int'))],
                        }),
                    ],
                    [opParam('id', scalarType('uuid'))],
                ),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            const idPos = output.indexOf('`id`');
            const pagePos = output.indexOf('`page`');
            expect(idPos).toBeLessThan(pagePos);
        });

        it('resolves string query reference to model fields', () => {
            const dto = contractRoot([
                model('Pagination', [
                    field('page', scalarType('int'), { description: 'Page number' }),
                    field('limit', scalarType('int'), { optional: true, description: 'Items per page' }),
                ]),
            ]);
            const op = opRoot([opRoute('/users', [opOperation('get', { query: 'Pagination' })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes | Page number |');
            expect(output).toContain('| `limit` | `number` | No | Items per page |');
        });

        it('resolves ref query type to model fields', () => {
            const dto = contractRoot([model('Pagination', [field('page', scalarType('int'))])]);
            const op = opRoot([opRoute('/users', [opOperation('get', { query: refType('Pagination') })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes |');
        });

        it('resolves intersection query to flattened fields', () => {
            const dto = contractRoot([model('Pagination', [field('page', scalarType('int'), { description: 'Page number' })])]);
            const query = intersectionType(
                refType('Pagination'),
                inlineObjectType([field('status', enumType('active', 'inactive'), { optional: true })]),
            );
            const op = opRoot([opRoute('/users', [opOperation('get', { query })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
            expect(output).toContain('| `page` | `number` | Yes | Page number |');
            expect(output).toContain('| `status` |');
        });

        it('omits Attributes section when no params', () => {
            const op = opRoot([opRoute('/health', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).not.toContain('Attributes');
        });
    });

    // ─── Request body ───────────────────────────────────────────

    describe('request body', () => {
        it('renders request body subheading with content type', () => {
            const op = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Request body (`application/json`)');
        });

        it('renders reference-style text for ref body', () => {
            const op = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Accepts a [CreateUser](#createuser) object.');
        });

        it('does not expand ref body into inline field table', () => {
            const dto = contractRoot([
                model('CreateUser', [
                    field('name', scalarType('string'), { description: 'The user name' }),
                    field('email', scalarType('email'), { description: 'The user email' }),
                ]),
            ]);
            const op = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('CreateUser') })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
            // Should reference the model, NOT expand fields inline
            expect(output).toContain('Accepts a [CreateUser](#createuser) object.');
            // Only check the endpoint section (before ## Models)
            const endpointSection = output.slice(output.indexOf('## Endpoints'), output.indexOf('## Models'));
            const reqSection = endpointSection.slice(endpointSection.indexOf('Request body'));
            // No field table in the request body section
            expect(reqSection).not.toContain('| `name`');
            expect(reqSection).not.toContain('| `email`');
        });

        it('expands inline object body into field table', () => {
            const bodyType = inlineObjectType([
                field('name', scalarType('string'), { description: 'The user name' }),
                field('email', scalarType('email'), { description: 'The user email' }),
            ]);
            const op = opRoot([opRoute('/users', [opOperation('post', { request: { bodies: [{ contentType: 'application/json', bodyType }] } })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('| `name` | `string` | Yes | The user name |');
            expect(output).toContain('| `email` | `string` | Yes | The user email |');
        });

        it('excludes readonly fields from inline object request body', () => {
            const bodyType = inlineObjectType([
                field('id', scalarType('uuid'), { visibility: 'readonly' }),
                field('name', scalarType('string'), { description: 'The user name' }),
            ]);
            const op = opRoot([opRoute('/users', [opOperation('post', { request: { bodies: [{ contentType: 'application/json', bodyType }] } })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('| `name`');
            expect(output).not.toContain('| `id`');
        });

        it('renders reference for unresolvable ref', () => {
            const op = opRoot([opRoute('/users', [opOperation('post', { request: opRequest('UnknownType') })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Accepts a [UnknownType](#unknowntype) object.');
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
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Response');
        });

        it('renders status code with reference-style text', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('`200 OK` — Returns a [User](#user) object.');
        });

        it('renders 204 no content without body', () => {
            const op = opRoot([
                opRoute('/users/{id}', [opOperation('delete', { responses: [opResponse(204)] })], [opParam('id', scalarType('uuid'))]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('`204 No Content`');
        });

        it('renders response headers table', () => {
            const op = opRoot([
                opRoute('/transfers/{id}', [
                    opOperation('get', {
                        responses: [
                            {
                                statusCode: 200,
                                contentType: 'application/json',
                                bodyType: { kind: 'ref', name: 'Transfer' },
                                headers: [
                                    { name: 'preference-applied', optional: true, type: scalarType('string') },
                                    { name: 'etag', optional: false, type: scalarType('string'), description: 'cache validator' },
                                ],
                            },
                        ],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Response headers:');
            expect(output).toContain('| `preference-applied` |');
            expect(output).toContain('| `etag` |');
            expect(output).toContain('*(required)*');
            expect(output).toContain('cache validator');
        });

        it('renders 201 Created status text', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('post', {
                        responses: [opResponse(201, 'User', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('`201 Created`');
        });

        it('does not expand ref response body inline', () => {
            const dto = contractRoot([
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
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
            // Should reference the model, NOT expand fields inline
            expect(output).toContain('`200 OK` — Returns a [User](#user) object.');
            // Only check the endpoint section (before ## Models)
            const endpointSection = output.slice(output.indexOf('## Endpoints'), output.indexOf('## Models'));
            const respSection = endpointSection.slice(endpointSection.indexOf('Response'));
            expect(respSection).not.toContain('| `id`');
            expect(respSection).not.toContain('| `name`');
        });

        it('expands inline object response body into field table', () => {
            const bodyType = inlineObjectType([
                field('id', scalarType('uuid'), { visibility: 'readonly', description: 'The ID' }),
                field('status', scalarType('string'), { description: 'The status' }),
            ]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [{ statusCode: 200, contentType: 'application/json', bodyType }],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('`200 OK`');
            expect(output).toContain('| `id` | `string` | Yes | The ID. *read-only* |');
            expect(output).toContain('| `status` | `string` | Yes | The status |');
        });

        it('renders array response as list reference', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [opResponse(200, 'array(User)', 'application/json')],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('Returns a list of [User](#user) objects.');
        });

        it('renders union response as alternatives', () => {
            const bodyType = unionType(refType('SimpleResult'), refType('DetailedResult'));
            const op = opRoot([
                opRoute('/search', [
                    opOperation('get', {
                        responses: [{ statusCode: 200, contentType: 'application/json', bodyType }],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('[SimpleResult](#simpleresult) or [DetailedResult](#detailedresult)');
        });
    });

    // ─── Model rendering ────────────────────────────────────────

    describe('models', () => {
        it('renders model name as heading', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('### User');
        });

        it('renders model description as blockquote', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))], { description: 'A user object' })]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('> A user object');
        });

        it('renders extends link for base model', () => {
            const dto = contractRoot([model('Admin', [field('role', scalarType('string'))], { base: 'User' })]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('Extends [`User`](#user)');
        });

        it('uses Attribute column header', () => {
            const dto = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('| Attribute | Type | Required | Description |');
        });

        it('renders fields table with types', () => {
            const dto = contractRoot([
                model('User', [field('id', scalarType('uuid')), field('name', scalarType('string')), field('email', scalarType('email'))]),
            ]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('| `id` | `string` | Yes |');
            expect(output).toContain('| `name` | `string` | Yes |');
            expect(output).toContain('| `email` | `string` | Yes |');
        });

        it('renders duration field as string type', () => {
            const dto = contractRoot([model('Task', [field('timeout', scalarType('duration'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('| `timeout` | `string` | Yes |');
        });

        it('marks optional fields as not required', () => {
            const dto = contractRoot([model('User', [field('bio', scalarType('string'), { optional: true })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('| `bio` | `string` | No |');
        });

        it('includes visibility modifiers in description', () => {
            const dto = contractRoot([
                model('User', [
                    field('id', scalarType('uuid'), { visibility: 'readonly' }),
                    field('password', scalarType('string'), { visibility: 'writeonly' }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('*read-only*');
            expect(output).toContain('*write-only*');
        });

        it('includes default values in description', () => {
            const dto = contractRoot([
                model('Config', [field('active', scalarType('boolean'), { default: true }), field('pageSize', scalarType('int'), { default: 25 })]),
            ]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('default: `true`');
            expect(output).toContain('default: `25`');
        });

        it('includes field description text', () => {
            const dto = contractRoot([model('User', [field('name', scalarType('string'), { description: 'The user name' })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('The user name');
        });

        it('renders type alias as code block', () => {
            const dto = contractRoot([model('Status', [], { type: enumType('active', 'inactive') })]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain("type Status = 'active' | 'inactive'");
        });

        it('includes nullable modifier', () => {
            const dto = contractRoot([model('User', [field('bio', scalarType('string'), { nullable: true, optional: true })])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('*nullable*');
        });
    });

    // ─── Multiple files combined ─────────────────────────────────

    describe('combining multiple files', () => {
        it('merges endpoints from multiple op files', () => {
            const op1 = opRoot([opRoute('/users', [opOperation('get')])]);
            const op2 = opRoot([opRoute('/orders', [opOperation('get')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op1, op2] });
            expect(output).toContain('**`GET`** `/users`');
            expect(output).toContain('**`GET`** `/orders`');
        });

        it('merges models from multiple contract files', () => {
            const dto1 = contractRoot([model('User', [field('id', scalarType('uuid'))])]);
            const dto2 = contractRoot([model('Order', [field('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [dto1, dto2], opRoots: [] });
            expect(output).toContain('### User');
            expect(output).toContain('### Order');
        });

        it('merges endpoints from same area into one group', () => {
            const op1 = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const op2 = opRoot([opRoute('/ledger/transactions', [opOperation('get')])], 'ledger.transactions.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op1, op2] });
            const matches = output.match(/### Ledger/g);
            expect(matches).toHaveLength(1);
            expect(output).toContain('**`GET`** `/ledger/accounts`');
            expect(output).toContain('**`GET`** `/ledger/transactions`');
        });
    });

    // ─── Formatting ─────────────────────────────────────────────

    describe('formatting', () => {
        it('renders horizontal rules between endpoints', () => {
            const op = opRoot([opRoute('/users', [opOperation('get'), opOperation('post')])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            const endpointsSection = output.slice(output.indexOf('## Endpoints'));
            expect(endpointsSection).toContain('\n---\n');
        });

        it('escapes pipe characters in enum types within tables', () => {
            const dto = contractRoot([model('User', [field('status', enumType('active', 'inactive'))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            // The pipe in 'active' | 'inactive' must be escaped as \|
            expect(output).toContain("'active' \\| 'inactive'");
            // Should NOT contain unescaped pipe that breaks the table
            expect(output).not.toContain("'active' | 'inactive'");
        });

        it('escapes pipe characters in union types within tables', () => {
            const dto = contractRoot([model('User', [field('value', unionType(scalarType('string'), scalarType('number')))])]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
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
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain("'asc' \\| 'desc'");
        });

        it('wraps endpoint attributes table in collapsed details', () => {
            const op = opRoot([opRoute('/users/{id}', [opOperation('get')], [opParam('id', scalarType('uuid'))])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('<details>');
            expect(output).toContain('<summary>Attributes (1)</summary>');
            expect(output).toContain('</details>');
        });

        it('wraps inline object request body fields in collapsed details', () => {
            const bodyType = inlineObjectType([field('name', scalarType('string')), field('email', scalarType('email'))]);
            const op = opRoot([opRoute('/users', [opOperation('post', { request: { bodies: [{ contentType: 'application/json', bodyType }] } })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('<summary>Attributes (2)</summary>');
        });

        it('wraps inline object response body fields in collapsed details', () => {
            const bodyType = inlineObjectType([field('id', scalarType('uuid')), field('name', scalarType('string'))]);
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', {
                        responses: [{ statusCode: 200, contentType: 'application/json', bodyType }],
                    }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('<summary>Attributes (2)</summary>');
        });

        it('wraps model fields in collapsed details', () => {
            const dto = contractRoot([
                model('User', [field('id', scalarType('uuid')), field('name', scalarType('string')), field('email', scalarType('email'))]),
            ]);
            const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
            expect(output).toContain('<summary>Attributes (3)</summary>');
        });

        it('wraps TOC area groups in collapsible details', () => {
            const op = opRoot([opRoute('/ledger/accounts', [opOperation('get')])], 'ledger.op', { area: 'ledger' });
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            const tocSection = output.slice(output.indexOf('**Endpoints**'), output.indexOf('---'));
            expect(tocSection).toContain('<details>');
            expect(tocSection).toContain('</details>');
        });
    });
});

describe('route modifiers', () => {
    describe('internal', () => {
        it('excludes an internal operation from the output', () => {
            const op = opRoot([
                opRoute('/users', [
                    opOperation('get', { responses: [opResponse(200)] }),
                    opOperation('post', { modifiers: ['internal'], responses: [opResponse(201)] }),
                ]),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('**`GET`** `/users`');
            expect(output).not.toContain('**`POST`** `/users`');
        });

        it('excludes all operations when route is internal', () => {
            const op = opRoot([
                opRoute(
                    '/admin/users',
                    [opOperation('get', { responses: [opResponse(200)] }), opOperation('delete', { responses: [opResponse(204)] })],
                    undefined,
                    ['internal'],
                ),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).not.toContain('`/admin/users`');
        });

        it('operation-level override on internal route makes that operation visible', () => {
            const op = opRoot([
                opRoute(
                    '/admin/users',
                    [
                        opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200)] }),
                        opOperation('post', { responses: [opResponse(201)] }),
                    ],
                    undefined,
                    ['internal'],
                ),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('**`GET`** `/admin/users`');
            expect(output).not.toContain('**`POST`** `/admin/users`');
        });

        it('does not count internal operations in TOC group summary', () => {
            const op = opRoot(
                [
                    opRoute('/ledger/accounts', [
                        opOperation('get', { responses: [opResponse(200)] }),
                        opOperation('post', { modifiers: ['internal'], responses: [opResponse(201)] }),
                    ]),
                ],
                'ledger.op',
                { area: 'ledger' },
            );
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            // Only 1 public operation — summary should say (1), not (2)
            expect(output).toContain('<strong>Ledger</strong> (1)');
        });
    });

    describe('deprecated', () => {
        it('renders a warning admonition for a deprecated operation', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { modifiers: ['deprecated'], responses: [opResponse(200)] })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).toContain('> [!WARNING]');
            expect(output).toContain('**Deprecated**');
        });

        it('does not render a warning admonition for a normal operation', () => {
            const op = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200)] })])]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            expect(output).not.toContain('> [!WARNING]');
        });

        it('cascades route-level deprecated to operations', () => {
            const op = opRoot([
                opRoute(
                    '/users',
                    [opOperation('get', { responses: [opResponse(200)] }), opOperation('post', { responses: [opResponse(201)] })],
                    undefined,
                    ['deprecated'],
                ),
            ]);
            const output = generateMarkdown({ contractRoots: [], opRoots: [op] });
            // Both operations inherit deprecated from route — both get the warning
            const warningCount = (output.match(/> \[\!WARNING\]/g) ?? []).length;
            expect(warningCount).toBe(2);
        });
    });
});

describe('model filtering by public reachability', () => {
    it('excludes models only referenced by internal operations', () => {
        const dto = contractRoot([model('WebhookPayload', [field('event', scalarType('string'))])]);
        const op = opRoot([
            opRoute(
                '/webhooks/internal',
                [
                    opOperation('post', {
                        request: opRequest('WebhookPayload'),
                        responses: [opResponse(204)],
                    }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
        expect(output).not.toContain('WebhookPayload');
    });

    it('includes models referenced by at least one public operation', () => {
        const dto = contractRoot([model('User', [field('id', scalarType('string'))])]);
        const op = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User')] })])]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
        expect(output).toContain('User');
    });

    it('includes models reachable transitively through a public op reference', () => {
        const dto = contractRoot([model('Order', [field('item', refType('OrderItem'))]), model('OrderItem', [field('sku', scalarType('string'))])]);
        const op = opRoot([opRoute('/orders', [opOperation('get', { responses: [opResponse(200, 'Order')] })])]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
        expect(output).toContain('Order');
        expect(output).toContain('OrderItem');
    });

    it('excludes transitively-internal-only models even if named by another internal op', () => {
        const dto = contractRoot(
            [model('InternalPayload', [field('data', scalarType('string'))]), model('InternalChild', [field('x', scalarType('number'))])],
            'webhooks.ck',
        );
        const op = opRoot([
            opRoute(
                '/internal/hook',
                [
                    opOperation('post', {
                        request: opRequest('InternalPayload'),
                        responses: [opResponse(204)],
                    }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
        expect(output).not.toContain('InternalPayload');
        expect(output).not.toContain('InternalChild');
    });

    it('shows all models when no .op files are present', () => {
        const dto = contractRoot([model('Standalone', [field('x', scalarType('string'))])]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [] });
        expect(output).toContain('Standalone');
    });

    it('keeps public model when shared by both internal and public ops', () => {
        const dto = contractRoot([model('SharedModel', [field('id', scalarType('string'))])]);
        const op = opRoot([
            opRoute('/public', [opOperation('get', { responses: [opResponse(200, 'SharedModel')] })]),
            opRoute(
                '/internal',
                [
                    opOperation('post', {
                        request: opRequest('SharedModel'),
                        responses: [opResponse(204)],
                    }),
                ],
                undefined,
                ['internal'],
            ),
        ]);
        const output = generateMarkdown({ contractRoots: [dto], opRoots: [op] });
        expect(output).toContain('SharedModel');
    });
});
