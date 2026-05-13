import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

describe('renderMarkdown', () => {
    it('renders paragraphs', () => {
        expect(renderMarkdown('hello world')).toBe('<p>hello world</p>');
    });

    it('joins consecutive non-blank lines into one paragraph', () => {
        expect(renderMarkdown('line one\nline two')).toBe('<p>line one line two</p>');
    });

    it('separates paragraphs on blank lines', () => {
        expect(renderMarkdown('one\n\ntwo')).toBe('<p>one</p>\n<p>two</p>');
    });

    it('renders headings', () => {
        expect(renderMarkdown('# Title\n## Subtitle')).toBe('<h1>Title</h1>\n<h2>Subtitle</h2>');
    });

    it('renders inline code', () => {
        expect(renderMarkdown('use `foo()` here')).toBe('<p>use <code>foo()</code> here</p>');
    });

    it('renders bold and italic', () => {
        expect(renderMarkdown('**bold** and *italic*')).toBe('<p><strong>bold</strong> and <em>italic</em></p>');
    });

    it('renders fenced code blocks with language', () => {
        const out = renderMarkdown('```ts\nconst x = 1;\n```');
        expect(out).toContain('class="ce-code"');
        expect(out).toContain('data-lang="ts"');
        expect(out).toContain('const x = 1;');
    });

    it('renders unordered lists', () => {
        expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    });

    it('renders ordered lists', () => {
        expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
    });

    it('renders http links', () => {
        expect(renderMarkdown('see [docs](https://example.com)')).toBe(
            '<p>see <a href="https://example.com" rel="noopener noreferrer">docs</a></p>',
        );
    });

    it('does not render javascript: links (escaped through)', () => {
        const out = renderMarkdown('[click](javascript:alert(1))');
        expect(out).not.toContain('href="javascript:');
    });

    it('escapes HTML in inline content', () => {
        expect(renderMarkdown('hi <script>')).toContain('&lt;script&gt;');
    });
});
