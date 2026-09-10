import { describe, it, expect } from 'vitest';
import { deriveSdkMethodName } from '../src/sdk-method-name.js';
import { opOperation, opRoute } from './helpers.js';

describe('deriveSdkMethodName', () => {
    it('uses sdk: verbatim', () => {
        const op = opOperation('get', { sdk: 'fetch_everything' });
        expect(deriveSdkMethodName(op, opRoute('/users', [op]))).toBe('fetch_everything');
    });

    it('prefers sdk: over name:', () => {
        const op = opOperation('get', { sdk: 'listAllUsers', name: 'Fetch users' });
        expect(deriveSdkMethodName(op, opRoute('/users', [op]))).toBe('listAllUsers');
    });

    it('camelCases name: over the verb and path', () => {
        // The step the docs' own copy of this rule skipped, documenting `postAuthToken`.
        const op = opOperation('post', { name: 'Request token' });
        expect(deriveSdkMethodName(op, opRoute('/auth/token', [op]))).toBe('requestToken');
    });

    it('splits name: on whitespace, hyphens and underscores', () => {
        const op = opOperation('get', { name: 'List  all_users-now' });
        expect(deriveSdkMethodName(op, opRoute('/users', [op]))).toBe('listAllUsersNow');
    });

    it('falls back to the verb and path', () => {
        const op = opOperation('post');
        expect(deriveSdkMethodName(op, opRoute('/users', [op]))).toBe('postUsers');
    });

    it('names a path parameter with By', () => {
        const op = opOperation('delete');
        expect(deriveSdkMethodName(op, opRoute('/accounts/{accountId}/users/{id}', [op]))).toBe('deleteAccountsByAccountIdUsersById');
    });

    it('camelCases hyphenated and dotted path segments', () => {
        const op = opOperation('get');
        expect(deriveSdkMethodName(op, opRoute('/ledger.categories/tax-codes', [op]))).toBe('getLedgerCategoriesTaxCodes');
    });
});
