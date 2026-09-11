import { describe, expect, it } from 'vitest';
import {
    RESERVED_TYPE_NAMES,
    SWIFT_RESERVED_WORDS,
    bindSwiftParameterNames,
    deriveSwiftFileBase,
    docLines,
    escapeSwiftIdentifier,
    quoteSwiftString,
    sanitizeSwiftTypeName,
    toSwiftCaseName,
    toSwiftPropertyName,
    toSwiftTypeName,
} from '../src/naming.js';

describe('escapeSwiftIdentifier', () => {
    it('backticks a reserved word so it can still be used as a name', () => {
        expect(escapeSwiftIdentifier('class')).toBe('`class`');
        expect(escapeSwiftIdentifier('default')).toBe('`default`');
        expect(escapeSwiftIdentifier('repeat')).toBe('`repeat`');
    });

    it('renames the words backticks do not rescue in member position', () => {
        expect(escapeSwiftIdentifier('self')).toBe('self_');
        expect(escapeSwiftIdentifier('init')).toBe('init_');
        expect(escapeSwiftIdentifier('Type')).toBe('Type_');
    });

    it('leaves a contextual keyword alone, since Swift accepts it bare', () => {
        for (const word of ['async', 'lazy', 'get', 'set', 'final', 'some', 'weak', 'optional', 'required']) {
            expect(escapeSwiftIdentifier(word)).toBe(word);
            expect(SWIFT_RESERVED_WORDS.has(word)).toBe(false);
        }
    });
});

describe('toSwiftPropertyName', () => {
    it('camelCases across separators', () => {
        expect(toSwiftPropertyName('x-request-id')).toBe('xRequestId');
        expect(toSwiftPropertyName('created_at')).toBe('createdAt');
        expect(toSwiftPropertyName('createdAt')).toBe('createdAt');
        expect(toSwiftPropertyName('myHTTPClient')).toBe('myHttpClient');
    });

    it('prefixes a leading digit, which Swift identifiers cannot start with', () => {
        expect(toSwiftPropertyName('2fa')).toBe('_2fa');
    });

    it('escapes a name that lands on a reserved word', () => {
        expect(toSwiftPropertyName('class')).toBe('`class`');
    });
});

describe('bindSwiftParameterNames', () => {
    it('converts and escapes like toSwiftPropertyName when nothing collides', () => {
        expect(bindSwiftParameterNames(['invoice-id', 'class', 'self'], [])).toEqual(
            new Map([
                ['invoice-id', 'invoiceId'],
                ['class', '`class`'],
                ['self', 'self_'],
            ]),
        );
    });

    it('suffixes a name that lands on one already taken', () => {
        expect(bindSwiftParameterNames(['body'], ['body']).get('body')).toBe('body_');
    });

    it('compares the unescaped spelling, since `class` in backticks is still class', () => {
        expect(bindSwiftParameterNames(['class'], ['class']).get('class')).toBe('class_');
    });

    it('keeps two names distinct when a suffix would collapse them onto one', () => {
        const bindings = bindSwiftParameterNames(['body', 'body_'], ['body']);
        expect(bindings.get('body')).toBe('body_');
        expect(bindings.get('body_')).toBe('body__');
    });
});

describe('toSwiftTypeName and sanitizeSwiftTypeName', () => {
    it('PascalCases a source name', () => {
        expect(toSwiftTypeName('payment-method')).toBe('PaymentMethod');
        // One word, so nothing inside it is capitalized; the prefix is what Swift needs.
        expect(toSwiftTypeName('2fa')).toBe('_2fa');
    });

    it('sanitizes an already-composed name without re-casing it', () => {
        // Re-casing would fold `MV` back to `Mv` and rename a declaration the hoist pass claimed.
        expect(sanitizeSwiftTypeName('MVOfString')).toBe('MVOfString');
        expect(sanitizeSwiftTypeName('Weird-Name')).toBe('WeirdName');
    });
});

describe('toSwiftCaseName', () => {
    it('lowerCamelCases an enum value', () => {
        expect(toSwiftCaseName('on hold')).toBe('onHold');
        expect(toSwiftCaseName('a-b')).toBe('aB');
        expect(toSwiftCaseName('PENDING')).toBe('pending');
    });

    it('gives an empty value a name and escapes a reserved one', () => {
        expect(toSwiftCaseName('')).toBe('blank');
        expect(toSwiftCaseName('default')).toBe('`default`');
        expect(toSwiftCaseName('1')).toBe('_1');
    });
});

describe('deriveSwiftFileBase', () => {
    it('drops the directory and both extensions', () => {
        expect(deriveSwiftFileBase('contracts/ledger.categories.op.ck')).toBe('LedgerCategories');
        expect(deriveSwiftFileBase('billing.ck')).toBe('Billing');
        expect(deriveSwiftFileBase('/abs/path/pay-ments.ck')).toBe('PayMents');
    });
});

describe('docLines', () => {
    it('renders every line as a /// comment at the given indent', () => {
        expect(docLines('One line', '')).toEqual(['/// One line']);
        expect(docLines('First\nSecond', '    ')).toEqual(['    /// First', '    /// Second']);
    });

    it('needs no delimiter escaping, unlike a block comment', () => {
        // A route described as `/auth/factors/*` closes a Kotlin KDoc early; a line comment cannot
        // be closed at all, so the text goes through as written.
        expect(docLines('Matches /auth/factors/*', '')).toEqual(['/// Matches /auth/factors/*']);
    });

    it('strips carriage returns so output does not depend on the source file line endings', () => {
        expect(docLines('First\r\nSecond', '')).toEqual(['/// First', '/// Second']);
    });
});

describe('quoteSwiftString', () => {
    it('escapes the characters a Swift literal cannot carry raw', () => {
        expect(quoteSwiftString('a"b')).toBe('"a\\"b"');
        expect(quoteSwiftString('a\\b')).toBe('"a\\\\b"');
        expect(quoteSwiftString('a\nb')).toBe('"a\\nb"');
    });

    it('escapes the backslash that would otherwise open an interpolation', () => {
        expect(quoteSwiftString('total: \\(count)')).toBe('"total: \\\\(count)"');
    });
});

describe('RESERVED_TYPE_NAMES', () => {
    it('covers the standard-library and runtime names the generated code uses unqualified', () => {
        for (const name of ['Error', 'Result', 'Data', 'Date', 'UUID', 'JSONValue', 'SdkHttp', 'Indirect', 'DecimalValue']) {
            expect(RESERVED_TYPE_NAMES.has(name)).toBe(true);
        }
    });
});
