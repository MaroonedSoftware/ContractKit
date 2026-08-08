import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Structural checks on the TextMate grammar.
 *
 * The highlighter has to accept everything the Ohm grammar accepts. It drifts silently: nothing
 * fails to build when a construct is parseable but unhighlighted, or when an `#include` points at
 * a repository key that no longer exists. These tests catch both without a tokenizer dependency.
 */

interface Pattern {
    include?: string;
    patterns?: Pattern[];
    [key: string]: unknown;
}

const grammar = JSON.parse(readFileSync(resolve(__dirname, '../syntaxes/ck.tmLanguage.json'), 'utf-8')) as {
    patterns: Pattern[];
    repository: Record<string, Pattern>;
};

/** Every `#name` include found anywhere in the grammar tree. */
function collectIncludes(node: unknown, out: string[] = []): string[] {
    if (Array.isArray(node)) {
        for (const child of node) collectIncludes(child, out);
    } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) {
            if (key === 'include' && typeof value === 'string') out.push(value);
            else collectIncludes(value, out);
        }
    }
    return out;
}

/** The `include` names listed directly under a repository rule. */
function directIncludes(rule: string): string[] {
    return (grammar.repository[rule]?.patterns ?? []).map(p => p.include).filter((x): x is string => typeof x === 'string');
}

describe('ck.tmLanguage — structure', () => {
    it('resolves every #include to a repository rule', () => {
        const missing = collectIncludes(grammar)
            .filter(name => name.startsWith('#'))
            .map(name => name.slice(1))
            .filter(name => !(name in grammar.repository));
        expect([...new Set(missing)]).toEqual([]);
    });
});

describe('ck.tmLanguage — options block', () => {
    // Mirrors the Ohm rule:
    //   OptionsBodyItem = comment | OptionsKeysBlock | OptionsServicesBlock
    //                   | OptionsRequestBlock | OptionsResponseBlock | SecurityBlock
    it('highlights every sub-block the parser accepts', () => {
        expect(directIncludes('options-block')).toEqual([
            '#comment',
            '#options-keys-block',
            '#options-services-block',
            '#options-request-block',
            '#options-response-block',
            '#security-decl',
        ]);
    });

    it('allows a comment directly in the options block', () => {
        // The grammar accepts a `#` line between sub-blocks, not just inside keys/services.
        expect(directIncludes('options-block')).toContain('#comment');
    });

    it('nests headers inside the request and response blocks', () => {
        expect(directIncludes('options-request-block')).toContain('#options-headers-block');
        expect(directIncludes('options-response-block')).toContain('#options-headers-block');
    });

    it('highlights header field declarations and comments inside a headers block', () => {
        expect(directIncludes('options-headers-block')).toEqual(['#comment', '#param-declaration']);
    });

    it('anchors the request and response blocks on their keyword', () => {
        expect(grammar.repository['options-request-block']?.begin).toBe('\\b(request)\\s*(:)\\s*(\\{)');
        expect(grammar.repository['options-response-block']?.begin).toBe('\\b(response)\\s*(:)\\s*(\\{)');
    });

    describe('status codes', () => {
        const begin = new RegExp(grammar.repository['status-code-block']!.begin as string);

        it('matches a bare status code', () => {
            expect(begin.exec('            404:')?.[1]).toBe('404');
        });

        it('matches a status code carrying the documented modifier', () => {
            const m = begin.exec('            404(documented): {');
            expect(m?.[1]).toBe('404');
            expect(m?.[2]).toBe('documented');
        });

        it('scopes the modifier as a keyword, like the http-method modifiers', () => {
            const captures = grammar.repository['status-code-block']?.beginCaptures as Record<string, { name: string }>;
            expect(captures['2']?.name).toBe('keyword.control.modifier.ck');
            expect(captures['3']?.name).toBe('punctuation.separator.colon.ck');
        });
    });
});
