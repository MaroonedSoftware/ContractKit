import { describe, it, expect } from 'vitest';
import { slugify, titleCase, deriveTitle, derivePageSlug, groupEndpoints, collectModels } from '../src/naming.js';
import { contractRoot, field, model, opOperation, opRoute, opRoot, scalarType } from './helpers.js';

describe('slugify', () => {
    it('lowercases and hyphenates', () => {
        expect(slugify('List Active Users')).toBe('list-active-users');
    });

    it('splits camelCase on the case boundary', () => {
        expect(slugify('listActiveUsers')).toBe('list-active-users');
    });

    it('collapses runs of punctuation into a single hyphen', () => {
        expect(slugify('users//{id}__profile')).toBe('users-id-profile');
    });

    it('trims leading and trailing separators', () => {
        expect(slugify('/users/')).toBe('users');
    });

    it('falls back to untitled when nothing survives', () => {
        expect(slugify('///')).toBe('untitled');
    });
});

describe('titleCase', () => {
    it('capitalizes each word', () => {
        expect(titleCase('list active users')).toBe('List Active Users');
    });
});

describe('deriveTitle', () => {
    const route = opRoute('/users', []);

    it('prefers the name field', () => {
        expect(deriveTitle(opOperation('get', { name: 'listActiveUsers' }), route)).toBe('List Active Users');
    });

    it('falls back to the service method', () => {
        expect(deriveTitle(opOperation('get', { service: 'users.findAll' }), route)).toBe('Find All');
    });

    it('falls back to verb plus path words', () => {
        expect(deriveTitle(opOperation('get', {}), route)).toBe('List users');
        expect(deriveTitle(opOperation('post', {}), route)).toBe('Create users');
        expect(deriveTitle(opOperation('delete', {}), route)).toBe('Delete users');
    });

    it('ignores path parameter segments in the fallback', () => {
        expect(deriveTitle(opOperation('patch', {}), opRoute('/users/{id}/roles', []))).toBe('Update users roles');
    });

    it('does not use the description, which becomes the page body', () => {
        expect(deriveTitle(opOperation('get', { description: 'Returns every user' }), route)).toBe('List users');
    });

    it('yields just the verb for a root path', () => {
        expect(deriveTitle(opOperation('get', {}), opRoute('/', []))).toBe('List');
    });
});

describe('derivePageSlug', () => {
    const route = opRoute('/users/{id}', []);

    it('prefers the sdk name', () => {
        expect(derivePageSlug(opOperation('get', { sdk: 'getUser', name: 'other' }), route)).toBe('get-user');
    });

    it('falls back to the name field', () => {
        expect(derivePageSlug(opOperation('get', { name: 'fetchUser' }), route)).toBe('fetch-user');
    });

    it('falls back to the service method', () => {
        expect(derivePageSlug(opOperation('get', { service: 'users.findOne' }), route)).toBe('find-one');
    });

    it('falls back to method plus literal path segments', () => {
        expect(derivePageSlug(opOperation('get', {}), route)).toBe('get-users');
    });
});

describe('groupEndpoints', () => {
    it('groups by the area meta and titles the group', () => {
        const root = opRoot([opRoute('/invoices', [opOperation('get', {})])], 'invoices.op', { area: 'billing' });
        const groups = groupEndpoints([root]);
        expect(groups).toHaveLength(1);
        expect(groups[0]!.area).toBe('billing');
        expect(groups[0]!.title).toBe('Billing');
        expect(groups[0]!.slug).toBe('billing');
    });

    it('puts area-less files first, under an Endpoints group', () => {
        const plain = opRoot([opRoute('/health', [opOperation('get', {})])], 'health.op');
        const areaed = opRoot([opRoute('/invoices', [opOperation('get', {})])], 'invoices.op', { area: 'billing' });
        const groups = groupEndpoints([areaed, plain]);
        expect(groups.map(g => g.title)).toEqual(['Endpoints', 'Billing']);
    });

    it('orders areas by first appearance', () => {
        const a = opRoot([opRoute('/a', [opOperation('get', {})])], 'a.op', { area: 'zeta' });
        const b = opRoot([opRoute('/b', [opOperation('get', {})])], 'b.op', { area: 'alpha' });
        expect(groupEndpoints([a, b]).map(g => g.area)).toEqual(['zeta', 'alpha']);
    });

    it('titles a multi-word area', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', {})])], 'x.op', { area: 'user-management' });
        expect(groupEndpoints([root])[0]!.title).toBe('User Management');
    });

    it('omits internal operations by default', () => {
        const root = opRoot([opRoute('/secret', [opOperation('get', { modifiers: ['internal'] })])]);
        expect(groupEndpoints([root])).toHaveLength(0);
    });

    it('includes internal operations when asked', () => {
        const root = opRoot([opRoute('/secret', [opOperation('get', { modifiers: ['internal'] })])]);
        expect(groupEndpoints([root], true)[0]!.endpoints).toHaveLength(1);
    });

    it('omits an operation made internal by its route', () => {
        const root = opRoot([opRoute('/secret', [opOperation('get', {})], undefined, ['internal'])]);
        expect(groupEndpoints([root])).toHaveLength(0);
    });

    it('de-duplicates colliding slugs within a group', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', {}), opOperation('get', {})])]);
        expect(groupEndpoints([root])[0]!.endpoints.map(e => e.slug)).toEqual(['get-users', 'get-users-2']);
    });

    it('lets the same slug appear in two different groups', () => {
        const a = opRoot([opRoute('/items', [opOperation('get', {})])], 'a.op', { area: 'alpha' });
        const b = opRoot([opRoute('/items', [opOperation('get', {})])], 'b.op', { area: 'beta' });
        expect(groupEndpoints([a, b]).map(g => g.endpoints[0]!.slug)).toEqual(['get-items', 'get-items']);
    });

    it('keeps operations in source order', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { name: 'listUsers' }), opOperation('post', { name: 'createUser' })]),
            opRoute('/users/{id}', [opOperation('delete', { name: 'deleteUser' })]),
        ]);
        expect(groupEndpoints([root])[0]!.endpoints.map(e => e.slug)).toEqual(['list-users', 'create-user', 'delete-user']);
    });
});

describe('collectModels', () => {
    const roots = [contractRoot([model('User', [field('id', scalarType('string'))]), model('Secret', [field('key', scalarType('string'))])])];

    it('keeps only models present in the spec', () => {
        expect(collectModels(roots, new Set(['User'])).map(m => m.title)).toEqual(['User']);
    });

    it('slugs the model name', () => {
        expect(collectModels(roots, new Set(['User']))[0]!.slug).toBe('user');
    });

    it('returns nothing when the spec has no schemas', () => {
        expect(collectModels(roots, new Set())).toEqual([]);
    });

    it('de-duplicates slugs that collide across files', () => {
        const dupes = [contractRoot([model('User', [])], 'a.ck'), contractRoot([model('user', [])], 'b.ck')];
        expect(collectModels(dupes, new Set(['User', 'user'])).map(m => m.slug)).toEqual(['user', 'user-2']);
    });
});
