import { describe, it, expect } from 'vitest';
import { frontmatter, page } from '../src/frontmatter.js';

describe('frontmatter', () => {
    it('wraps the entries in a fenced block', () => {
        expect(frontmatter([['title', 'User']])).toBe(['---', 'title: "User"', '---'].join('\n'));
    });

    it('quotes a string so a colon or a quote stays parseable', () => {
        expect(frontmatter([['title', 'Users: the "good" ones']])).toContain('title: "Users: the \\"good\\" ones"');
    });

    it('writes a number bare', () => {
        expect(frontmatter([['sidebar_position', 3]])).toContain('sidebar_position: 3');
    });

    it('writes true bare and drops false', () => {
        expect(frontmatter([['deprecated', true]])).toContain('deprecated: true');
        expect(frontmatter([['deprecated', false]])).not.toContain('deprecated');
    });

    it('drops an undefined value, so an optional entry can be passed unconditionally', () => {
        expect(
            frontmatter([
                ['title', 'User'],
                ['description', undefined],
            ]),
        ).toBe(['---', 'title: "User"', '---'].join('\n'));
    });

    it('nests a record one level, indented', () => {
        expect(frontmatter([['mdx', { format: 'md' }]])).toBe(['---', 'mdx:', '    format: "md"', '---'].join('\n'));
    });

    it('drops an empty record rather than leaving a dangling key', () => {
        expect(frontmatter([['mdx', {}]])).toBe(['---', '---'].join('\n'));
    });

    it('keeps entries in the order given', () => {
        expect(
            frontmatter([
                ['b', 1],
                ['a', 2],
            ]),
        ).toBe(['---', 'b: 1', 'a: 2', '---'].join('\n'));
    });
});

describe('page', () => {
    it('ends a bodyless page right after the frontmatter', () => {
        expect(page(frontmatter([['title', 'User']]))).toBe(['---', 'title: "User"', '---', ''].join('\n'));
    });

    it('separates a body from the frontmatter with a blank line and ends with a newline', () => {
        expect(page('---\n---', '  Hello.  ')).toBe('---\n---\n\nHello.\n');
    });

    it('treats a whitespace-only body as no body', () => {
        expect(page('---\n---', '   \n  ')).toBe('---\n---\n');
    });
});
