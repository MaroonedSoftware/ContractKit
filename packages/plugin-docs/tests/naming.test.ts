import { describe, it, expect } from 'vitest';
import { slugify, titleCase, humanize, deriveTitle, derivePageSlug, groupEndpoints, groupModels } from '../src/naming.js';
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

describe('humanize', () => {
    it('splits camelCase, as real area names are written', () => {
        expect(humanize('bankConnections')).toBe('Bank Connections');
        expect(humanize('cardAuth')).toBe('Card Auth');
    });

    it('splits on separators', () => {
        expect(humanize('user-management')).toBe('User Management');
        expect(humanize('user_management')).toBe('User Management');
    });

    it('leaves a single lowercase word alone but capitalized', () => {
        expect(humanize('billpay')).toBe('Billpay');
    });
});

describe('deriveTitle', () => {
    const route = opRoute('/users', []);

    it('prefers the name field', () => {
        expect(deriveTitle(opOperation('get', { name: 'listActiveUsers' }), route)).toBe('List Active Users');
    });

    it('falls back to the description, which titles better than a bare method name', () => {
        expect(deriveTitle(opOperation('get', { description: 'list every user', service: 'users.findAll' }), route)).toBe('List Every User');
    });

    it('makes a third-person description imperative', () => {
        expect(deriveTitle(opOperation('post', { description: 'creates a payment' }), route)).toBe('Create A Payment');
    });

    it('leaves a double-s verb alone', () => {
        expect(deriveTitle(opOperation('post', { description: 'process a refund' }), route)).toBe('Process A Refund');
    });

    it('falls back to the service method when there is no description', () => {
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

    it('titles a camelCase area, the style real contracts use', () => {
        const root = opRoot([opRoute('/x', [opOperation('get', {})])], 'x.op', { area: 'bankConnections' });
        const group = groupEndpoints([root])[0]!;
        expect(group.title).toBe('Bank Connections');
        expect(group.slug).toBe('bank-connections');
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

describe('groupModels', () => {
    const roots = [contractRoot([model('User', [field('id', scalarType('string'))]), model('Secret', [field('key', scalarType('string'))])])];

    it('keeps only models present in the spec', () => {
        expect(groupModels(roots, new Set(['User'])).flatMap(g => g.models.map(m => m.title))).toEqual(['User']);
    });

    it('slugs the model name', () => {
        expect(groupModels(roots, new Set(['User']))[0]!.models[0]!.slug).toBe('user');
    });

    it('returns nothing when the spec has no schemas', () => {
        expect(groupModels(roots, new Set())).toEqual([]);
    });

    it('puts area-less models in one group with an empty directory slug', () => {
        const groups = groupModels(roots, new Set(['User', 'Secret']));
        expect(groups).toHaveLength(1);
        expect(groups[0]!.area).toBeUndefined();
        expect(groups[0]!.title).toBe('Models');
        expect(groups[0]!.slug).toBe('');
    });

    it('groups by the contract file area', () => {
        const areaed = [
            contractRoot([model('Invoice', [])], 'billing.ck', { area: 'billing' }),
            contractRoot([model('User', [])], 'identity.ck', { area: 'identity' }),
        ];
        const groups = groupModels(areaed, new Set(['Invoice', 'User']));
        expect(groups.map(g => [g.title, g.slug])).toEqual([
            ['Billing', 'billing'],
            ['Identity', 'identity'],
        ]);
    });

    it('splits camelCase areas the way endpoint groups do', () => {
        const areaed = [contractRoot([model('Link', [])], 'bc.ck', { area: 'bankConnections' })];
        const group = groupModels(areaed, new Set(['Link']))[0]!;
        expect(group.title).toBe('Bank Connections');
        expect(group.slug).toBe('bank-connections');
    });

    it('puts area-less models first, before any area group', () => {
        const mixed = [contractRoot([model('Invoice', [])], 'billing.ck', { area: 'billing' }), contractRoot([model('Shared', [])], 'shared.ck')];
        expect(groupModels(mixed, new Set(['Invoice', 'Shared'])).map(g => g.title)).toEqual(['Models', 'Billing']);
    });

    it('orders areas by first appearance', () => {
        const areaed = [contractRoot([model('A', [])], 'z.ck', { area: 'zeta' }), contractRoot([model('B', [])], 'a.ck', { area: 'alpha' })];
        expect(groupModels(areaed, new Set(['A', 'B'])).map(g => g.area)).toEqual(['zeta', 'alpha']);
    });

    it('merges two files that share an area', () => {
        const areaed = [contractRoot([model('A', [])], 'a.ck', { area: 'billing' }), contractRoot([model('B', [])], 'b.ck', { area: 'billing' })];
        const groups = groupModels(areaed, new Set(['A', 'B']));
        expect(groups).toHaveLength(1);
        expect(groups[0]!.models.map(m => m.title)).toEqual(['A', 'B']);
    });

    it('de-duplicates slugs that collide within one area', () => {
        const dupes = [contractRoot([model('User', [])], 'a.ck', { area: 'x' }), contractRoot([model('user', [])], 'b.ck', { area: 'x' })];
        expect(groupModels(dupes, new Set(['User', 'user']))[0]!.models.map(m => m.slug)).toEqual(['user', 'user-2']);
    });

    it('lets the same slug appear in two different areas, since they get separate directories', () => {
        const same = [contractRoot([model('User', [])], 'a.ck', { area: 'alpha' }), contractRoot([model('User', [])], 'b.ck', { area: 'beta' })];
        expect(groupModels(same, new Set(['User'])).map(g => g.models[0]!.slug)).toEqual(['user', 'user']);
    });
});
