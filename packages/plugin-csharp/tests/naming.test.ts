import { describe, expect, it } from 'vitest';
import {
    CSHARP_KEYWORDS,
    deriveCSharpFileBase,
    escapeCSharpIdentifier,
    escapeXml,
    quoteCSharpString,
    safeMemberName,
    sanitizeCSharpTypeName,
    toCSharpEnumMemberName,
    toCSharpParameterName,
    toCSharpPropertyName,
    toCSharpTypeName,
    xmlDocLines,
} from '../src/naming.js';

describe('escapeCSharpIdentifier', () => {
    it('prefixes a reserved keyword with @', () => {
        expect(escapeCSharpIdentifier('params')).toBe('@params');
        expect(escapeCSharpIdentifier('event')).toBe('@event');
        expect(escapeCSharpIdentifier('string')).toBe('@string');
    });

    it('leaves a contextual keyword alone, since it is a legal identifier', () => {
        for (const name of ['record', 'required', 'init', 'value', 'var', 'async', 'await', 'yield', 'when']) {
            expect(CSHARP_KEYWORDS.has(name)).toBe(false);
            expect(escapeCSharpIdentifier(name)).toBe(name);
        }
    });
});

describe('toCSharpPropertyName', () => {
    it('PascalCases across separators and camelCase boundaries', () => {
        expect(toCSharpPropertyName('x-request-id')).toBe('XRequestId');
        expect(toCSharpPropertyName('created_at')).toBe('CreatedAt');
        expect(toCSharpPropertyName('createdAt')).toBe('CreatedAt');
        expect(toCSharpPropertyName('myHTTPClient')).toBe('MyHttpClient');
    });

    it('prefixes a leading digit, which C# identifiers cannot start with', () => {
        expect(toCSharpPropertyName('2fa')).toBe('_2fa');
    });

    it('never needs keyword escaping, because every C# keyword is lowercase', () => {
        expect(toCSharpPropertyName('params')).toBe('Params');
        expect(toCSharpPropertyName('class')).toBe('Class');
    });
});

describe('toCSharpParameterName', () => {
    it('camelCases a hyphenated path placeholder', () => {
        expect(toCSharpParameterName('invoice-id')).toBe('invoiceId');
        expect(toCSharpParameterName('paymentId')).toBe('paymentId');
    });

    it('escapes a name that lands on a keyword, which camelCase regularly does', () => {
        expect(toCSharpParameterName('event')).toBe('@event');
        expect(toCSharpParameterName('params')).toBe('@params');
    });
});

describe('safeMemberName', () => {
    it('renames a member that matches its enclosing type, which C# rejects', () => {
        expect(safeMemberName('Invoice', 'Invoice')).toBe('InvoiceValue');
        expect(safeMemberName('Id', 'Invoice')).toBe('Id');
    });

    it('renames a member a record already synthesizes', () => {
        expect(safeMemberName('Equals', 'Payment')).toBe('EqualsValue');
        expect(safeMemberName('ToString', 'Payment')).toBe('ToStringValue');
        expect(safeMemberName('EqualityContract', 'Payment')).toBe('EqualityContractValue');
    });
});

describe('toCSharpTypeName and sanitizeCSharpTypeName', () => {
    it('PascalCases a source name', () => {
        expect(toCSharpTypeName('payment-method')).toBe('PaymentMethod');
        expect(toCSharpTypeName('billing')).toBe('Billing');
    });

    it('sanitizes an already-composed name without re-casing it', () => {
        expect(sanitizeCSharpTypeName('MV')).toBe('MV');
        expect(toCSharpTypeName('MV')).toBe('Mv');
        expect(sanitizeCSharpTypeName('Get-Payment200')).toBe('GetPayment200');
    });
});

describe('toCSharpEnumMemberName', () => {
    it('PascalCases the wire value, which travels separately', () => {
        expect(toCSharpEnumMemberName('in-progress')).toBe('InProgress');
        expect(toCSharpEnumMemberName('pending')).toBe('Pending');
        expect(toCSharpEnumMemberName('2fa')).toBe('_2fa');
    });
});

describe('deriveCSharpFileBase', () => {
    it('takes the PascalCase base of a .ck path', () => {
        expect(deriveCSharpFileBase('contracts/ledger.categories.ck')).toBe('LedgerCategories');
        expect(deriveCSharpFileBase('contracts/billing.op.ck')).toBe('Billing');
    });
});

describe('xmlDocLines', () => {
    it('renders a single line inline and multiple lines as a block', () => {
        expect(xmlDocLines('A payment', '    ')).toEqual(['    /// <summary>A payment</summary>']);
        expect(xmlDocLines('One\nTwo', '')).toEqual(['/// <summary>', '/// One', '/// Two', '/// </summary>']);
    });

    it('escapes XML, since a malformed doc comment is a warning and the build treats it as an error', () => {
        expect(xmlDocLines('a < b && c > d', '')).toEqual(['/// <summary>a &lt; b &amp;&amp; c &gt; d</summary>']);
        expect(escapeXml('<T>')).toBe('&lt;T&gt;');
    });

    it('takes the tag name, so a thrown status can be documented as an exception', () => {
        expect(xmlDocLines('On 404.', '    ', 'remarks')).toEqual(['    /// <remarks>On 404.</remarks>']);
    });

    it('returns nothing for empty text, so callers can splat unconditionally', () => {
        expect(xmlDocLines('', '')).toEqual([]);
    });
});

describe('quoteCSharpString', () => {
    it('escapes the characters that would end or break the literal', () => {
        expect(quoteCSharpString('a"b')).toBe('"a\\"b"');
        expect(quoteCSharpString('a\\b')).toBe('"a\\\\b"');
        expect(quoteCSharpString('a\nb')).toBe('"a\\nb"');
    });

    it('leaves $ alone, since no generated literal built from contract text is interpolated', () => {
        expect(quoteCSharpString('a${b}')).toBe('"a${b}"');
    });
});
