import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** A line anchor: a substring for unambiguous text, a pattern when indentation matters. */
export type Anchor = string | RegExp;

export interface Excerpt {
    code: string;
    /** 1-based line of the excerpt's first line in the source file, for the gutter. */
    firstLine: number;
    /** Repo-relative path the excerpt came from. */
    file: string;
}

/**
 * Pulls a contiguous run of lines out of a checked-in contract.
 *
 * Anchored on text rather than line numbers so an edit to a contract shifts the excerpt instead
 * of silently changing which code the figure shows. A missing anchor throws — a figure quietly
 * rendering the wrong twelve lines is worse than a failed render.
 */
export function excerpt(file: string, start: Anchor, end: Anchor, endOccurrence = 1): Excerpt {
    const source = readFileSync(resolve(repoRoot, file), 'utf8');
    const lines = source.split('\n');

    const from = lines.findIndex(line => matches(line, start));
    if (from === -1) throw new Error(`excerpt: no line matching ${JSON.stringify(start)} in ${file}`);

    // `endOccurrence` is how an excerpt spans several declarations: the end anchor for a
    // top-level block is `}`, and the nth `}` is the end of the nth declaration.
    const ends = lines.slice(from).flatMap((line, index) => (matches(line, end) ? [index] : []));
    const offset = ends[endOccurrence - 1] ?? -1;
    if (offset === -1) {
        throw new Error(`excerpt: fewer than ${endOccurrence} lines matching ${JSON.stringify(end)} after ${JSON.stringify(start)} in ${file}`);
    }

    return { code: lines.slice(from, from + offset + 1).join('\n'), firstLine: from + 1, file };
}

/** Strips the common leading indentation, for excerpts lifted out of a nested block. */
export function dedent(code: string): string {
    const lines = code.split('\n').filter(line => line.trim() !== '');
    const indent = Math.min(...lines.map(line => line.length - line.trimStart().length));
    return code
        .split('\n')
        .map(line => line.slice(indent))
        .join('\n');
}

function matches(line: string, anchor: Anchor): boolean {
    return typeof anchor === 'string' ? line.includes(anchor) : anchor.test(line);
}
