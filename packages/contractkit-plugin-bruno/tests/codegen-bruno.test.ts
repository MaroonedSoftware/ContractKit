import { describe, it, expect } from 'vitest';
import { generateOpenCollection, sanitizePath, MANIFEST_FILENAME, parseManifest } from '../src/codegen-bruno.js';
import {
    opRoot,
    opRoute,
    opOperation,
    opParam,
    opResponse,
    paramNodes,
    paramRef,
    paramType,
    opRequest,
    scalarType,
    enumType,
    inlineObjectType,
    field,
    arrayType,
    refType,
    model,
    contractRoot,
} from './helpers.js';

describe('generateOpenCollection', () => {
    it('generates opencollection.yml with correct spec version and collection name', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'My API' });
        const rootFile = files.find(f => f.relativePath === 'opencollection.yml');
        expect(rootFile).toBeDefined();
        expect(rootFile!.content).toContain('opencollection: "1.0.0"');
        expect(rootFile!.content).toContain('info:');
        expect(rootFile!.content).toContain('name: My API');
    });

    it('generates Local environment file with baseUrl variable', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const envFile = files.find(f => f.relativePath === 'environments/local.yml');
        expect(envFile).toBeDefined();
        expect(envFile!.content).toContain('name: Local');
        expect(envFile!.content).toContain('variables:');
        expect(envFile!.content).toContain('- name: baseUrl');
        expect(envFile!.content).toContain('value: "http://localhost:3000"');
        expect(envFile!.content).not.toContain('enabled:');
        expect(envFile!.content).not.toContain('secret:');
    });

    it('creates one folder per op root file', () => {
        const usersRoot = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const paymentsRoot = opRoot([opRoute('/payments', [opOperation('get')])], 'payments.op');
        const files = generateOpenCollection([usersRoot, paymentsRoot], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'users/folder.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'payments/folder.yml')).toBe(true);
    });

    it('folder.yml has info block with name, type: folder, and seq', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'src/users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const folderFile = files.find(f => f.relativePath === 'users/folder.yml');
        expect(folderFile!.content).toContain('info:');
        expect(folderFile!.content).toContain('name: Users');
        expect(folderFile!.content).toContain('type: folder');
        expect(folderFile!.content).toContain('seq: 1');
    });

    it('generates one .yml file per route+method combination', () => {
        const root = opRoot(
            [
                opRoute('/users', [opOperation('get'), opOperation('post')]),
                opRoute('/users/{id}', [opOperation('get'), opOperation('delete')]),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'users/get-users.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'users/post-users.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'users/get-users-id.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'users/delete-users-id.yml')).toBe(true);
    });

    it('request info block has name, type: http, and seq', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('name: /users');
        expect(yml!.content).toContain('type: http');
        expect(yml!.content).toContain('seq: 1');
    });

    it('seq increments across operations within a folder', () => {
        const root = opRoot([opRoute('/users', [opOperation('get'), opOperation('post')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.find(f => f.relativePath === 'users/get-users.yml')!.content).toContain('seq: 1');
        expect(files.find(f => f.relativePath === 'users/post-users.yml')!.content).toContain('seq: 2');
    });

    it('uses slugified name as filename when op.name is set', () => {
        const root = opRoot([opRoute('/offers', [opOperation('post', { name: 'Create an Offer' })])], 'offers.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'offers/create-an-offer.yml')).toBe(true);
    });

    it('falls back to method-path filename when op.name is not set', () => {
        const root = opRoot([opRoute('/offers', [opOperation('post')])], 'offers.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'offers/post-offers.yml')).toBe(true);
    });

    // ─── Subarea ────────────────────────────────────────────────────────────

    it('uses area meta as the top-level folder name', () => {
        const root = opRoot([opRoute('/offers', [opOperation('get')])], 'capital.op', { area: 'payments' });
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'payments/folder.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'payments/get-offers.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'capital/get-offers.yml')).toBe(false);
    });

    it('falls back to filename when no area meta', () => {
        const root = opRoot([opRoute('/offers', [opOperation('get')])], 'capital.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'capital/get-offers.yml')).toBe(true);
    });

    it('places request files in subfolder when subarea meta is set', () => {
        const root = opRoot([opRoute('/offers', [opOperation('post')])], 'capital.op', { subarea: 'expansion' });
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'capital/expansion/post-offers.yml')).toBe(true);
        expect(files.some(f => f.relativePath === 'capital/post-offers.yml')).toBe(false);
    });

    it('generates folder.yml for subarea with correct name', () => {
        const root = opRoot([opRoute('/offers', [opOperation('post')])], 'capital.op', { subarea: 'expansion' });
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const subfolderFile = files.find(f => f.relativePath === 'capital/expansion/folder.yml');
        expect(subfolderFile).toBeDefined();
        expect(subfolderFile!.content).toContain('name: Expansion');
        expect(subfolderFile!.content).toContain('type: folder');
    });

    it('still generates top-level folder.yml when subarea is set', () => {
        const root = opRoot([opRoute('/offers', [opOperation('post')])], 'capital.op', { subarea: 'expansion' });
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'capital/folder.yml')).toBe(true);
    });

    it('slugifies subarea for the folder path', () => {
        const root = opRoot([opRoute('/offers', [opOperation('get')])], 'capital.op', { subarea: 'Expansion Capital' });
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'capital/expansion-capital/get-offers.yml')).toBe(true);
    });

    it('places request files directly in folder when no subarea', () => {
        const root = opRoot([opRoute('/offers', [opOperation('get')])], 'capital.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath === 'capital/get-offers.yml')).toBe(true);
        expect(files.every(f => f.relativePath !== 'capital/folder.yml' || !f.relativePath.includes('/capital/'))).toBe(true);
    });

    it('uses {{baseUrl}} prefix and Bruno :param syntax for path params', () => {
        const root = opRoot([opRoute('/users/{id}', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('url: "{{baseUrl}}/users/:id"');
    });

    // ─── Path params ────────────────────────────────────────────────────────

    it('generates path params as flat array entries with type: path', () => {
        const root = opRoot([opRoute('/users/{id}', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('- name: id');
        expect(yml!.content).toContain('type: path');
        expect(yml!.content).not.toMatch(/^\s+path:\s*$/m);
    });

    it('uses uuid example value for uuid path params', () => {
        const root = opRoot(
            [opRoute('/users/{id}', [opOperation('get')], paramNodes([opParam('id', scalarType('uuid'))]))],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('value: "00000000-0000-0000-0000-000000000000"');
    });

    it('uses typed example values for scalar path params', () => {
        const root = opRoot(
            [
                opRoute('/reports/{date}', [opOperation('get')], paramNodes([opParam('date', scalarType('date'))])),
            ],
            'reports.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'reports/get-reports-date.yml');
        expect(yml!.content).toContain('value: "2024-01-01"');
    });

    it('uses ISO 8601 duration example value for duration path params', () => {
        const root = opRoot(
            [opRoute('/jobs/{timeout}', [opOperation('get')], paramNodes([opParam('timeout', scalarType('duration'))]))],
            'jobs.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'jobs/get-jobs-timeout.yml');
        expect(yml!.content).toContain('value: "PT1H"');
    });

    it('uses first enum value as example for enum path params', () => {
        const root = opRoot(
            [opRoute('/items/{status}', [opOperation('get')], paramNodes([opParam('status', enumType('active', 'archived'))]))],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'items/get-items-status.yml');
        expect(yml!.content).toContain('value: "active"');
    });

    it('falls back to empty string for untyped path params', () => {
        // params not declared — route.params is undefined
        const root = opRoot([opRoute('/users/{id}', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('value: ""');
    });

    it('does not generate params block when path has no params and no query', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.find(f => f.relativePath === 'users/get-users.yml')!.content).not.toContain('params:');
    });

    // ─── Query params ───────────────────────────────────────────────────────

    it('generates query params as flat array entries with type: query', () => {
        const root = opRoot(
            [
                opRoute('/users', [
                    opOperation('get', {
                        query: paramNodes([opParam('limit', scalarType('int')), opParam('offset', scalarType('int'))]),
                    }),
                ]),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('- name: limit');
        expect(yml!.content).toContain('- name: offset');
        expect(yml!.content).toContain('type: query');
        expect(yml!.content).toContain('value: "0"');
    });

    it('uses typed example values for query params', () => {
        const root = opRoot(
            [
                opRoute('/users', [
                    opOperation('get', {
                        query: paramNodes([opParam('email', scalarType('email'))]),
                    }),
                ]),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('value: "user@example.com"');
    });

    it('falls back to single placeholder entry for ref query params with no registry', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { query: paramRef('UserQuery') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('- name: userQuery');
        expect(yml!.content).toContain('type: query');
    });

    it('expands ref query params into individual fields when model registry provided', () => {
        const paginationModel = model('Pagination', [
            field('page', scalarType('int'), { optional: true }),
            field('pageSize', scalarType('int'), { optional: true }),
            field('total', scalarType('int'), { visibility: 'readonly' }),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { query: paramRef('Pagination') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([paginationModel])] });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('- name: page');
        expect(yml!.content).toContain('- name: pageSize');
        expect(yml!.content).not.toContain('- name: total');
        expect(yml!.content).not.toContain('- name: pagination');
    });

    it('mixes path and query params in the same flat array', () => {
        const root = opRoot(
            [
                opRoute('/users/{id}', [
                    opOperation('get', {
                        query: paramNodes([opParam('include', scalarType('string'))]),
                    }),
                ]),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('type: path');
        expect(yml!.content).toContain('type: query');
    });

    // ─── Headers ────────────────────────────────────────────────────────────

    it('generates headers block from op.headers inline params', () => {
        const root = opRoot(
            [
                opRoute('/events', [
                    opOperation('post', {
                        headers: paramNodes([opParam('X-Idempotency-Key', scalarType('uuid'))]),
                        request: opRequest('EventInput'),
                    }),
                ]),
            ],
            'events.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'events/post-events.yml');
        expect(yml!.content).toContain('headers:');
        expect(yml!.content).toContain('- name: X-Idempotency-Key');
        expect(yml!.content).toContain('value: "00000000-0000-0000-0000-000000000000"');
    });

    it('falls back to single placeholder entry for ref header source with no registry', () => {
        const root = opRoot(
            [opRoute('/items', [opOperation('get', { headers: paramRef('AuthHeaders') })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'items/get-items.yml');
        expect(yml!.content).toContain('headers:');
        expect(yml!.content).toContain('- name: authHeaders');
    });

    it('expands ref header source into individual fields when model registry provided', () => {
        const headersModel = model('AuthHeaders', [
            field('X-Api-Key', scalarType('string')),
            field('X-Idempotency-Key', scalarType('uuid'), { optional: true }),
        ]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { headers: paramRef('AuthHeaders') })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([headersModel])] });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('- name: X-Api-Key');
        expect(yml!.content).toContain('- name: X-Idempotency-Key');
        expect(yml!.content).not.toContain('- name: authHeaders');
    });

    it('does not generate headers block when op has no headers', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).not.toContain('headers:');
    });

    // ─── Request body ────────────────────────────────────────────────────────

    it('generates body with type: json and data block literal for JSON requests', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('type: json');
        expect(yml!.content).toContain('data: |');
    });

    it('expands inline object body type into a JSON skeleton', () => {
        const bodyType = inlineObjectType([
            field('name', scalarType('string')),
            field('email', scalarType('email')),
            field('age', scalarType('int')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest(bodyType) })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('"name": ""');
        expect(yml!.content).toContain('"email": "user@example.com"');
        expect(yml!.content).toContain('"age": 0');
    });

    it('uses ISO 8601 duration example value in body skeleton', () => {
        const bodyType = inlineObjectType([field('timeout', scalarType('duration'))]);
        const root = opRoot(
            [opRoute('/jobs', [opOperation('post', { request: opRequest(bodyType) })])],
            'jobs.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'jobs/post-jobs.yml');
        expect(yml!.content).toContain('"timeout": "PT1H"');
    });

    it('excludes readonly fields from inline object body skeleton', () => {
        const bodyType = inlineObjectType([
            field('id', scalarType('uuid'), { visibility: 'readonly' }),
            field('name', scalarType('string')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest(bodyType) })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).not.toContain('"id"');
        expect(yml!.content).toContain('"name": ""');
    });

    it('uses empty object for ref body types when no contractRoots provided', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('data: |');
        expect(yml!.content).toContain('{}');
    });

    it('expands ref body type into a JSON skeleton when contractRoots provided', () => {
        const userModel = model('CreateUserInput', [
            field('name', scalarType('string')),
            field('email', scalarType('email')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([userModel])] });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('"name": ""');
        expect(yml!.content).toContain('"email": "user@example.com"');
    });

    it('excludes readonly fields from expanded ref body', () => {
        const userModel = model('CreateUserInput', [
            field('id', scalarType('uuid'), { visibility: 'readonly' }),
            field('name', scalarType('string')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([userModel])] });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).not.toContain('"id"');
        expect(yml!.content).toContain('"name": ""');
    });

    it('sets optional fields to null in expanded ref body', () => {
        const userModel = model('CreateUserInput', [
            field('name', scalarType('string')),
            field('nickname', scalarType('string'), { optional: true }),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([userModel])] });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('"name": ""');
        expect(yml!.content).toContain('"nickname": null');
    });

    it('expands inherited fields from base model in ref body', () => {
        const baseModel = model('BaseEntity', [field('id', scalarType('uuid'), { visibility: 'readonly' })]);
        const userModel = model('CreateUserInput', [field('name', scalarType('string'))], { base: 'BaseEntity' });
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest('CreateUserInput') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([baseModel, userModel])] });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        // readonly id from base is excluded
        expect(yml!.content).not.toContain('"id"');
        expect(yml!.content).toContain('"name": ""');
    });

    it('uses field default value in body for non-optional fields', () => {
        const bodyType = inlineObjectType([
            field('status', enumType('pending', 'active'), { default: 'pending' }),
            field('priority', scalarType('int'), { default: 1 }),
        ]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { request: opRequest(bodyType) })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('"status": "pending"');
        expect(yml!.content).toContain('"priority": 1');
    });

    it('uses field default value in body for optional fields', () => {
        const bodyType = inlineObjectType([
            field('status', enumType('pending', 'active'), { optional: true, default: 'pending' }),
        ]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { request: opRequest(bodyType) })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('"status": "pending"');
    });

    it('uses field defaults from expanded ref model body', () => {
        const itemModel = model('CreateItemInput', [
            field('status', enumType('draft', 'published'), { default: 'draft' }),
            field('count', scalarType('int'), { default: 0 }),
        ]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { request: opRequest('CreateItemInput') })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([itemModel])] });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('"status": "draft"');
        expect(yml!.content).toContain('"count": 0');
    });

    it('uses first enum value in body', () => {
        const bodyType = inlineObjectType([field('status', enumType('pending', 'active', 'archived'))]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { request: opRequest(bodyType) })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('"status": "pending"');
    });

    it('uses example values for nested array fields in body', () => {
        const bodyType = inlineObjectType([field('tags', arrayType(scalarType('string')))]);
        const root = opRoot(
            [opRoute('/posts', [opOperation('post', { request: opRequest(bodyType) })])],
            'posts.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'posts/post-posts.yml');
        expect(yml!.content).toContain('"tags": [');
    });

    it('leaves ref fields as empty objects in body', () => {
        const bodyType = inlineObjectType([field('address', refType('Address'))]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest(bodyType) })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('"address": {}');
    });

    it('generates body with type: multipart-form for multipart requests', () => {
        const root = opRoot(
            [opRoute('/uploads', [opOperation('post', { request: opRequest('UploadInput', 'multipart/form-data') })])],
            'uploads.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'uploads/post-uploads.yml');
        expect(yml!.content).toContain('type: multipart-form');
        expect(yml!.content).not.toContain('type: json');
    });

    it('does not generate body block when no request body', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.find(f => f.relativePath === 'users/get-users.yml')!.content).not.toContain('body:');
    });

    // ─── Misc ────────────────────────────────────────────────────────────────

    it('handles empty roots array', () => {
        const files = generateOpenCollection([], { collectionName: 'Empty' });
        // opencollection.yml + environments/local.yml + manifest
        expect(files).toHaveLength(3);
        expect(files.some(f => f.relativePath === MANIFEST_FILENAME)).toBe(true);
    });

    it('derives folder name from file path with directory prefix', () => {
        const root = opRoot([opRoute('/payments', [opOperation('get')])], 'src/api/payments.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.some(f => f.relativePath.startsWith('payments/'))).toBe(true);
    });

    it('does not generate any .bru files', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        expect(files.every(f => !f.relativePath.endsWith('.bru'))).toBe(true);
    });

    // ─── Auth ─────────────────────────────────────────────────────────────────

    const bearerAuth = { defaultScheme: 'bearerAuth', schemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } };
    const apiKeyAuth = { defaultScheme: 'apiKey', schemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' } } };
    const basicAuth = { defaultScheme: 'basicAuth', schemes: { basicAuth: { type: 'http', scheme: 'basic' } } };

    it('adds bearer auth block to opencollection.yml when security config provided', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: bearerAuth });
        const col = files.find(f => f.relativePath === 'opencollection.yml');
        expect(col!.content).toContain('request:');
        expect(col!.content).toContain('  auth:');
        expect(col!.content).toContain('type: bearer');
        expect(col!.content).toContain('token: "{{token}}"');
    });

    it('adds apikey auth block to opencollection.yml', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: apiKeyAuth });
        const col = files.find(f => f.relativePath === 'opencollection.yml');
        expect(col!.content).toContain('request:');
        expect(col!.content).toContain('  auth:');
        expect(col!.content).toContain('type: apikey');
        expect(col!.content).toContain('key: X-Api-Key');
        expect(col!.content).toContain('value: "{{apiKey}}"');
    });

    it('adds basic auth block to opencollection.yml', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: basicAuth });
        const col = files.find(f => f.relativePath === 'opencollection.yml');
        expect(col!.content).toContain('request:');
        expect(col!.content).toContain('  auth:');
        expect(col!.content).toContain('type: basic');
        expect(col!.content).toContain('username: "{{username}}"');
        expect(col!.content).toContain('password: "{{password}}"');
    });

    it('adds auth env vars to local.yml for bearer', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: bearerAuth });
        const env = files.find(f => f.relativePath === 'environments/local.yml');
        expect(env!.content).toContain('- name: token');
    });

    it('does not add request or auth to opencollection.yml when no security config', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const col = files.find(f => f.relativePath === 'opencollection.yml');
        expect(col!.content).not.toContain('request:');
        expect(col!.content).not.toContain('auth:');
    });

    it('adds auth: none inside http block when operation security is none', () => {
        const root = opRoot([opRoute('/public', [opOperation('get', { security: 'none' })])], 'public.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: bearerAuth });
        const yml = files.find(f => f.relativePath === 'public/get-public.yml');
        expect(yml!.content).toContain('  auth:');
        expect(yml!.content).toContain('    type: none');
        expect(yml!.content).not.toContain('request:');
    });

    it('adds auth: inherit inside http block for normal operations when default scheme is set', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API', auth: bearerAuth });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('  auth: inherit');
    });

    it('does not add auth when no default scheme is set', () => {
        const root = opRoot([opRoute('/public', [opOperation('get', { security: 'none' })])], 'public.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'public/get-public.yml');
        expect(yml!.content).not.toContain('auth:');
    });

    // ─── runtime.assertions (response status check) ─────────────────────────

    it('emits a status-code assertion using the first declared 2xx response', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { responses: [opResponse(201), opResponse(400)] })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('runtime:');
        expect(yml!.content).toContain('  assertions:');
        expect(yml!.content).toContain('    - expression: res.status');
        expect(yml!.content).toContain('      operator: eq');
        expect(yml!.content).toContain('      value: "201"');
    });

    it('falls back to the first response when no 2xx is declared', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { responses: [opResponse(404)] })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('value: "404"');
    });

    it('does not emit a runtime block when the operation declares no responses', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).not.toContain('runtime:');
    });

    it('emits assertions for required response headers and lists them in the docs', () => {
        const root = opRoot(
            [
                opRoute(
                    '/transfers/{id}',
                    [
                        opOperation('get', {
                            responses: [
                                {
                                    statusCode: 200,
                                    contentType: 'application/json',
                                    bodyType: { kind: 'ref', name: 'Transfer' },
                                    headers: [
                                        { name: 'preference-applied', optional: true, type: { kind: 'scalar', name: 'string' } },
                                        { name: 'ETag', optional: false, type: { kind: 'scalar', name: 'string' }, description: 'cache validator' },
                                    ],
                                },
                            ],
                        }),
                    ],
                ),
            ],
            'transfers.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'transfers/get-transfers-id.yml');
        expect(yml!.content).toContain('value: "200"');
        // Required header gets an assertion using lowercased name; optional one does not.
        expect(yml!.content).toContain('    - expression: res.headers["etag"]');
        expect(yml!.content).toContain('      operator: isDefined');
        expect(yml!.content).not.toContain('res.headers["preference-applied"]');
        // Both headers documented.
        expect(yml!.content).toContain('**Response headers**');
        expect(yml!.content).toContain('- `preference-applied` (optional)');
        expect(yml!.content).toContain('- `ETag` (required) — cache validator');
    });

    // ─── docs ──────────────────────────────────────────────────────────────

    it('emits a docs block from the operation description', () => {
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { description: 'Lists every user.' })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('docs: |-');
        expect(yml!.content).toContain('  Lists every user.');
    });

    it('combines route and operation descriptions into the docs block', () => {
        const root = opRoot(
            [
                opRoute(
                    '/users',
                    [opOperation('get', { description: 'GET semantics.' })],
                    undefined,
                    undefined,
                    { description: 'User-management endpoints.' },
                ),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).toContain('  User-management endpoints.');
        expect(yml!.content).toContain('  GET semantics.');
    });

    it('does not emit a docs block when no description is set', () => {
        const root = opRoot([opRoute('/users', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        expect(yml!.content).not.toContain('docs:');
    });

    // ─── disabled flag for optional params/headers ────────────────────────

    it('marks optional query params with disabled: true', () => {
        const root = opRoot(
            [
                opRoute('/users', [
                    opOperation('get', {
                        query: paramNodes([
                            opParam('limit', scalarType('int'), { optional: true }),
                            opParam('cursor', scalarType('string')),
                        ]),
                    }),
                ]),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        // limit (optional) is disabled; cursor (required) is not
        const limitBlock = yml!.content.match(/- name: limit[\s\S]*?(?=- name:|headers:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        const cursorBlock = yml!.content.match(/- name: cursor[\s\S]*?(?=- name:|headers:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        expect(limitBlock).toContain('disabled: true');
        expect(cursorBlock).not.toContain('disabled: true');
    });

    it('marks optional headers with disabled: true', () => {
        const root = opRoot(
            [
                opRoute('/events', [
                    opOperation('post', {
                        headers: paramNodes([
                            opParam('X-Idempotency-Key', scalarType('uuid'), { optional: true }),
                            opParam('X-Trace-Id', scalarType('string')),
                        ]),
                    }),
                ]),
            ],
            'events.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'events/post-events.yml');
        const idemBlock = yml!.content.match(/- name: X-Idempotency-Key[\s\S]*?(?=- name:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        const traceBlock = yml!.content.match(/- name: X-Trace-Id[\s\S]*?(?=- name:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        expect(idemBlock).toContain('disabled: true');
        expect(traceBlock).not.toContain('disabled: true');
    });

    it('does not mark path params as disabled even though they have no optional flag', () => {
        const root = opRoot([opRoute('/users/{id}', [opOperation('get')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).not.toContain('disabled:');
    });

    it('marks optional fields from a ref-expanded query model as disabled', () => {
        const queryModel = model('UserQuery', [
            field('limit', scalarType('int'), { optional: true }),
            field('search', scalarType('string')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('get', { query: paramRef('UserQuery') })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', contractRoots: [contractRoot([queryModel])] });
        const yml = files.find(f => f.relativePath === 'users/get-users.yml');
        const limitBlock = yml!.content.match(/- name: limit[\s\S]*?(?=- name:|headers:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        const searchBlock = yml!.content.match(/- name: search[\s\S]*?(?=- name:|headers:|body:|runtime:|docs:|$)/)?.[0] ?? '';
        expect(limitBlock).toContain('disabled: true');
        expect(searchBlock).not.toContain('disabled: true');
    });

    // ─── Manifest ──────────────────────────────────────────────────────────

    it('emits a manifest listing every generated file', () => {
        const root = opRoot([opRoute('/users', [opOperation('get'), opOperation('post')])], 'users.op');
        const files = generateOpenCollection([root], { collectionName: 'API' });
        const manifest = files.find(f => f.relativePath === MANIFEST_FILENAME);
        expect(manifest).toBeDefined();
        const tracked = parseManifest(manifest!.content);
        expect(tracked).toContain('opencollection.yml');
        expect(tracked).toContain('environments/local.yml');
        expect(tracked).toContain('users/folder.yml');
        expect(tracked).toContain('users/get-users.yml');
        expect(tracked).toContain('users/post-users.yml');
        expect(tracked).toContain(MANIFEST_FILENAME);
    });

    it('parseManifest returns [] for malformed input', () => {
        expect(parseManifest('not json')).toEqual([]);
        expect(parseManifest('{}')).toEqual([]);
        expect(parseManifest('{"files": "nope"}')).toEqual([]);
        expect(parseManifest('{"files": [1, 2, 3]}')).toEqual([]);
    });

    // ─── randomExamples ───────────────────────────────────────────────────

    it('emits Bruno faker templates for compatible scalar params when randomExamples is true', () => {
        const root = opRoot(
            [
                opRoute(
                    '/users/{id}',
                    [
                        opOperation('get', {
                            query: paramNodes([
                                opParam('email', scalarType('email')),
                                opParam('limit', scalarType('int')),
                                opParam('active', scalarType('boolean')),
                                opParam('since', scalarType('datetime')),
                            ]),
                        }),
                    ],
                    paramNodes([opParam('id', scalarType('uuid'))]),
                ),
            ],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', randomExamples: true });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('value: "{{$randomUUID}}"');
        expect(yml!.content).toContain('value: "{{$randomEmail}}"');
        expect(yml!.content).toContain('value: "{{$randomInt}}"');
        expect(yml!.content).toContain('value: "{{$randomBoolean}}"');
        expect(yml!.content).toContain('value: "{{$isoTimestamp}}"');
    });

    it('keeps deterministic placeholders when randomExamples is false', () => {
        const root = opRoot(
            [opRoute('/users/{id}', [opOperation('get')], paramNodes([opParam('id', scalarType('uuid'))]))],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', randomExamples: false });
        const yml = files.find(f => f.relativePath === 'users/get-users-id.yml');
        expect(yml!.content).toContain('value: "00000000-0000-0000-0000-000000000000"');
        expect(yml!.content).not.toContain('{{$randomUUID}}');
    });

    it('uses faker templates inside JSON body skeletons for string-valued scalars', () => {
        const bodyType = inlineObjectType([
            field('id', scalarType('uuid')),
            field('email', scalarType('email')),
            field('createdAt', scalarType('datetime')),
            field('age', scalarType('int')),
            field('active', scalarType('boolean')),
        ]);
        const root = opRoot(
            [opRoute('/users', [opOperation('post', { request: opRequest(bodyType) })])],
            'users.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', randomExamples: true });
        const yml = files.find(f => f.relativePath === 'users/post-users.yml');
        expect(yml!.content).toContain('"id": "{{$randomUUID}}"');
        expect(yml!.content).toContain('"email": "{{$randomEmail}}"');
        expect(yml!.content).toContain('"createdAt": "{{$isoTimestamp}}"');
        // Numbers and booleans stay deterministic so the JSON skeleton is valid.
        expect(yml!.content).toContain('"age": 0');
        expect(yml!.content).toContain('"active": true');
    });

    it('does not override field defaults when randomExamples is true', () => {
        const bodyType = inlineObjectType([
            field('status', enumType('pending', 'active'), { default: 'pending' }),
            field('id', scalarType('uuid')),
        ]);
        const root = opRoot(
            [opRoute('/items', [opOperation('post', { request: opRequest(bodyType) })])],
            'items.op',
        );
        const files = generateOpenCollection([root], { collectionName: 'API', randomExamples: true });
        const yml = files.find(f => f.relativePath === 'items/post-items.yml');
        expect(yml!.content).toContain('"status": "pending"');
        expect(yml!.content).toContain('"id": "{{$randomUUID}}"');
    });
});

describe('sanitizePath', () => {
    it('converts simple path to filename-safe string', () => {
        expect(sanitizePath('/users')).toBe('users');
    });

    it('replaces path params with their names', () => {
        expect(sanitizePath('/users/{id}')).toBe('users-id');
    });

    it('handles multiple segments and params', () => {
        expect(sanitizePath('/orgs/{orgId}/users/{userId}')).toBe('orgs-orgId-users-userId');
    });

    it('returns root for bare slash', () => {
        expect(sanitizePath('/')).toBe('root');
    });

    it('collapses consecutive dashes', () => {
        expect(sanitizePath('/users//posts')).toBe('users-posts');
    });
});
