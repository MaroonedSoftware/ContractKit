import { describe, it, expect } from 'vitest';
import { JS_RESERVED_WORDS, bindIdentifiers } from '../src/reserved-words.js';

describe('JS_RESERVED_WORDS', () => {
    it('holds the words strict-mode module code cannot bind', () => {
        for (const word of ['class', 'default', 'in', 'new', 'await', 'yield', 'let', 'static', 'arguments', 'eval']) {
            expect(JS_RESERVED_WORDS.has(word), word).toBe(true);
        }
    });

    it('leaves out contextual words, which are legal bindings', () => {
        for (const word of ['from', 'of', 'type', 'async', 'as', 'get', 'set']) {
            expect(JS_RESERVED_WORDS.has(word), word).toBe(false);
        }
    });
});

describe('bindIdentifiers', () => {
    it('returns an ordinary name unchanged', () => {
        expect(bindIdentifiers(['seatId'], [])).toEqual(new Map([['seatId', 'seatId']]));
    });

    it('suffixes a reserved word', () => {
        expect(bindIdentifiers(['class'], []).get('class')).toBe('class_');
    });

    it('suffixes a name the surrounding code already binds', () => {
        expect(bindIdentifiers(['body'], ['body']).get('body')).toBe('body_');
    });

    it('converts a hyphenated name before checking it', () => {
        expect(bindIdentifiers(['invoice-id'], []).get('invoice-id')).toBe('invoiceId');
    });

    it('keeps two names distinct when a suffix would collapse them onto one', () => {
        const bindings = bindIdentifiers(['body', 'body_'], ['body']);
        expect(bindings.get('body')).toBe('body_');
        expect(bindings.get('body_')).toBe('body__');
    });

    it('lets a key keep a keyword when given no reserved set', () => {
        expect(bindIdentifiers(['class'], ['body'], new Set()).get('class')).toBe('class');
    });
});
