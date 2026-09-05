import { describe, expect, it } from 'vitest';
import {
    deriveKotlinFileBase,
    escapeKotlinIdentifier,
    kdocLines,
    toKotlinEnumEntryName,
    toKotlinPropertyName,
    toKotlinTypeName,
} from '../src/naming.js';

describe('escapeKotlinIdentifier', () => {
    it('backticks hard keywords and leaves everything else alone', () => {
        expect(escapeKotlinIdentifier('object')).toBe('`object`');
        expect(escapeKotlinIdentifier('when')).toBe('`when`');
        expect(escapeKotlinIdentifier('payment')).toBe('payment');
    });

    it('leaves soft and modifier keywords unescaped, since they are legal identifiers', () => {
        expect(escapeKotlinIdentifier('data')).toBe('data');
        expect(escapeKotlinIdentifier('value')).toBe('value');
        expect(escapeKotlinIdentifier('by')).toBe('by');
    });
});

describe('toKotlinPropertyName', () => {
    it('camelCases separator-delimited names', () => {
        expect(toKotlinPropertyName('x-request-id')).toBe('xRequestId');
        expect(toKotlinPropertyName('first_name')).toBe('firstName');
        expect(toKotlinPropertyName('my.field-name')).toBe('myFieldName');
    });

    it('leaves camelCase names unchanged', () => {
        expect(toKotlinPropertyName('createdAt')).toBe('createdAt');
        expect(toKotlinPropertyName('name')).toBe('name');
    });

    it('prefixes a leading digit, which cannot start a Kotlin identifier', () => {
        expect(toKotlinPropertyName('2fa')).toBe('_2fa');
    });

    it('escapes a name that lands on a keyword', () => {
        expect(toKotlinPropertyName('object')).toBe('`object`');
    });
});

describe('toKotlinTypeName', () => {
    it('PascalCases and strips separators', () => {
        expect(toKotlinTypeName('payment')).toBe('Payment');
        expect(toKotlinTypeName('user-profile')).toBe('UserProfile');
        expect(toKotlinTypeName('myHTTPClient')).toBe('MyHttpClient');
    });
});

describe('toKotlinEnumEntryName', () => {
    it('screaming-snake-cases values', () => {
        expect(toKotlinEnumEntryName('pending')).toBe('PENDING');
        expect(toKotlinEnumEntryName('in-progress')).toBe('IN_PROGRESS');
        expect(toKotlinEnumEntryName('partiallyPaid')).toBe('PARTIALLY_PAID');
    });
});

describe('deriveKotlinFileBase', () => {
    it('PascalCases the file stem', () => {
        expect(deriveKotlinFileBase('payment.ck')).toBe('Payment');
        expect(deriveKotlinFileBase('ledger.categories.ck')).toBe('LedgerCategories');
        expect(deriveKotlinFileBase('/path/to/user.profile.ck')).toBe('UserProfile');
    });

    it('strips the .op.ck suffix', () => {
        expect(deriveKotlinFileBase('payments.op.ck')).toBe('Payments');
    });
});

describe('kdocLines', () => {
    it('renders a single line inline and multiple lines as a block', () => {
        expect(kdocLines('A payment', '')).toEqual(['/** A payment */']);
        expect(kdocLines('First.\nSecond.', '    ')).toEqual(['    /**', '     * First.', '     * Second.', '     */']);
    });

    it('breaks up a comment terminator that would close the block early', () => {
        expect(kdocLines('ends with */ here', '').join('\n')).not.toContain('*/ here');
    });

    it('breaks up a comment OPENER, which nests in Kotlin and would swallow the rest of the file', () => {
        // Kotlin block comments nest, so `/*` inside a KDoc opens a second comment that the
        // KDoc's own terminator then closes — leaving the outer one open. A contract describing
        // a route as `/auth/factors/*` did exactly this, and the compiler reported it at the next
        // declaration rather than anywhere near the text.
        const rendered = kdocLines('the only /auth/factors/* route', '').join('\n');

        expect(rendered).not.toContain('/* route');
        expect(rendered).toContain('/\\* route');
    });
});
