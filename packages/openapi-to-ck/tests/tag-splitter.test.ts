import { describe, it, expect } from 'vitest';
import { splitByTag, mergeIntoSingle } from '../src/tag-splitter.js';
import { model, field, scalarType, refType, arrayType, opRoute, opOperation, opResponse } from './helpers.js';
import type { OpRouteNode } from '@contractkit/core';

describe('splitByTag', () => {
    it('splits routes into separate files by tag', () => {
        const userModel = model('User', [field('id', scalarType('uuid'))]);
        const postModel = model('Post', [field('id', scalarType('uuid')), field('author', refType('User'))]);

        const userRoute = opRoute('/users', [opOperation('get', { responses: [opResponse(200, arrayType(refType('User')), 'application/json')] })]);
        const postRoute = opRoute('/posts', [opOperation('get', { responses: [opResponse(200, arrayType(refType('Post')), 'application/json')] })]);

        const routeTags = new Map<OpRouteNode, string>([
            [userRoute, 'users'],
            [postRoute, 'posts'],
        ]);

        const result = splitByTag([userModel, postModel], [userRoute, postRoute], routeTags);

        expect(result.has('users.ck')).toBe(true);
        expect(result.has('posts.ck')).toBe(true);

        const usersFile = result.get('users.ck')!;
        expect(usersFile.routes).toContain(userRoute);
        expect(usersFile.models.some(m => m.name === 'User')).toBe(true);

        const postsFile = result.get('posts.ck')!;
        expect(postsFile.routes).toContain(postRoute);
        expect(postsFile.models.some(m => m.name === 'Post')).toBe(true);
    });

    it('puts models referenced by multiple tags in shared.ck', () => {
        const sharedModel = model('Pagination', [field('page', scalarType('int'))]);

        const route1 = opRoute('/users', [opOperation('get', { query: 'Pagination', responses: [] })]);
        const route2 = opRoute('/posts', [opOperation('get', { query: 'Pagination', responses: [] })]);

        const routeTags = new Map<OpRouteNode, string>([
            [route1, 'users'],
            [route2, 'posts'],
        ]);

        const result = splitByTag([sharedModel], [route1, route2], routeTags);
        expect(result.has('shared.ck')).toBe(true);
        expect(result.get('shared.ck')!.models.some(m => m.name === 'Pagination')).toBe(true);
    });

    it('puts orphan models in shared.ck', () => {
        const orphan = model('Config', [field('key', scalarType('string'))]);
        const result = splitByTag([orphan], [], new Map());
        expect(result.has('shared.ck')).toBe(true);
        expect(result.get('shared.ck')!.models.some(m => m.name === 'Config')).toBe(true);
    });

    it('assigns untagged routes to default.ck', () => {
        const route = opRoute('/health', [opOperation('get', { responses: [opResponse(200)] })]);
        const routeTags = new Map<OpRouteNode, string>([[route, 'default']]);

        const result = splitByTag([], [route], routeTags);
        expect(result.has('default.ck')).toBe(true);
    });
});

describe('mergeIntoSingle', () => {
    it('merges all models and routes into one CkRootNode', () => {
        const models = [model('User', [field('id', scalarType('uuid'))])];
        const routes = [opRoute('/users', [opOperation('get', { responses: [] })])];

        const result = mergeIntoSingle(models, routes);
        expect(result.models).toBe(models);
        expect(result.routes).toBe(routes);
        expect(result.file).toBe('api.ck');
    });
});
