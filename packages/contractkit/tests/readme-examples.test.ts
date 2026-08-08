import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCk } from '../src/parser.js';
import { DiagnosticCollector } from '../src/diagnostics.js';

/**
 * Every documented example that presents itself as a whole `.ck` file has to compile.
 *
 * Prose drifts from the grammar silently, and a reader's first move is to copy an example — this
 * check caught three invalid constructs in the README cheat sheet and eight `{ ... }` elisions in
 * the language reference when it was introduced.
 *
 * Fragments are deliberately exempt. Showing a single field (`nickname?: string`) or a single verb
 * block is the right granularity for a reference, and wrapping three dozen of them in
 * `operation /x: { … }` scaffolding would bury the point of each one. A block counts as a whole
 * file only when its first line of real syntax opens a top-level declaration, which leaves `...`
 * inside a fragment readable as the elision it is.
 */
const DOCS = ['README.md', 'docs/language.md', 'docs/config.md', 'docs/tooling.md'];

/** Untagged fenced blocks whose first non-comment line starts a top-level declaration. */
function wholeFileBlocks(markdown: string): { src: string; line: number }[] {
    const out: { src: string; line: number }[] = [];
    for (const m of markdown.matchAll(/```(\w*)\n([\s\S]*?)```/g)) {
        if (m[1] !== '') continue;
        const src = m[2]!;
        const firstSyntax = src.split('\n').find(l => l.trim() && !l.trim().startsWith('#'));
        if (!firstSyntax || !/^(options|contract|operation)\b/.test(firstSyntax)) continue;
        out.push({ src, line: markdown.slice(0, m.index!).split('\n').length + 1 });
    }
    return out;
}

describe('documented .ck examples', () => {
    for (const doc of DOCS) {
        const markdown = readFileSync(new URL(`../../../${doc}`, import.meta.url).pathname, 'utf8');
        const blocks = wholeFileBlocks(markdown);

        for (const { src, line } of blocks) {
            it(`${doc}:${line} compiles`, () => {
                const diag = new DiagnosticCollector();
                parseCk(src, `${doc}-${line}.ck`, diag);
                const errors = diag.getAll().filter(d => d.severity === 'error');
                expect(errors.map(e => e.message.split('\n').filter(Boolean).pop()?.trim())).toEqual([]);
            });
        }
    }

    // Guards the extractor itself: a regex change that quietly matched nothing would make every
    // check above vacuous.
    it('extracts whole-file examples from the README and the language reference', () => {
        const count = (doc: string) => wholeFileBlocks(readFileSync(new URL(`../../../${doc}`, import.meta.url).pathname, 'utf8')).length;
        expect(count('README.md')).toBeGreaterThanOrEqual(2);
        expect(count('docs/language.md')).toBeGreaterThanOrEqual(20);
    });
});
