import { escapeHtml } from './html.js';

/**
 * Minimal block + inline Markdown renderer used for `description:` fields in models and operations.
 * Supports paragraphs, headings, fenced code blocks, inline code, **bold**, *italic*, [links](url),
 * unordered lists (`-` or `*` bullets), and ordered lists. Anything else passes through as text.
 *
 * Intentionally small (~80 LOC) so the webview bundle stays lean. For richer needs we can swap to
 * `marked` later — the API matches.
 */
export function renderMarkdown(input: string): string {
    if (!input) return '';
    const lines = input.replace(/\r\n/g, '\n').split('\n');
    const out: string[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i] ?? '';

        // Fenced code block
        const fence = /^```(\w*)\s*$/.exec(line);
        if (fence) {
            const lang = fence[1] ?? '';
            const buf: string[] = [];
            i++;
            while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
                buf.push(lines[i] ?? '');
                i++;
            }
            i++; // skip closing fence
            const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : '';
            out.push(`<pre class="ce-code"${langAttr}><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
            continue;
        }

        // Heading
        const heading = /^(#{1,6})\s+(.+)$/.exec(line);
        if (heading) {
            const level = heading[1]!.length;
            out.push(`<h${level}>${renderInline(heading[2]!)}</h${level}>`);
            i++;
            continue;
        }

        // Unordered list
        if (/^\s*[-*]\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
                items.push(renderInline((lines[i] ?? '').replace(/^\s*[-*]\s+/, '')));
                i++;
            }
            out.push(`<ul>${items.map(t => `<li>${t}</li>`).join('')}</ul>`);
            continue;
        }

        // Ordered list
        if (/^\s*\d+\.\s+/.test(line)) {
            const items: string[] = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i] ?? '')) {
                items.push(renderInline((lines[i] ?? '').replace(/^\s*\d+\.\s+/, '')));
                i++;
            }
            out.push(`<ol>${items.map(t => `<li>${t}</li>`).join('')}</ol>`);
            continue;
        }

        // Blank → paragraph break
        if (line.trim() === '') {
            i++;
            continue;
        }

        // Paragraph (consume consecutive non-blank, non-special lines)
        const buf: string[] = [line];
        i++;
        while (i < lines.length) {
            const next = lines[i] ?? '';
            if (next.trim() === '' || /^```/.test(next) || /^#{1,6}\s/.test(next) || /^\s*[-*]\s/.test(next) || /^\s*\d+\.\s/.test(next)) break;
            buf.push(next);
            i++;
        }
        out.push(`<p>${renderInline(buf.join(' '))}</p>`);
    }

    return out.join('\n');
}

function renderInline(text: string): string {
    // First escape, then re-introduce supported inline patterns.
    let s = escapeHtml(text);

    // Inline code: `code`
    s = s.replace(/`([^`]+)`/g, (_m, code: string) => `<code>${code}</code>`);

    // Bold: **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Italic: *text* (single asterisks, no other asterisks inside)
    s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, (_m, before: string, body: string) => `${before}<em>${body}</em>`);

    // Links: [text](url) — only http(s) URLs to avoid `javascript:` injection.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label: string, url: string) => {
        return `<a href="${url}" rel="noopener noreferrer">${label}</a>`;
    });

    return s;
}
