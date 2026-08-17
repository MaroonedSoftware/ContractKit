import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHighlighter, type Highlighter, type ThemedToken } from 'shiki';
import type { ThemeName } from './palette.ts';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The extension's own TextMate grammar, loaded from source rather than copied.
 *
 * This is the point of rendering the figures instead of hand-colouring them: a change to
 * `ck.tmLanguage.json` shows up in the documentation the next time `pnpm docs:images` runs, so a
 * screenshot can never drift from what the editor actually does.
 */
export const CK_GRAMMAR_PATH = resolve(here, '../../../apps/vscode-extension/syntaxes/ck.tmLanguage.json');

export type Lang = 'ck' | 'typescript' | 'python' | 'json' | 'bash' | 'yaml';

let highlighterPromise: Promise<Highlighter> | undefined;

export function getHighlighter(): Promise<Highlighter> {
    highlighterPromise ??= create();
    return highlighterPromise;
}

async function create(): Promise<Highlighter> {
    const grammar = JSON.parse(readFileSync(CK_GRAMMAR_PATH, 'utf8'));
    // Shiki keys languages by `name`; the file calls itself "Contract DSL".
    grammar.name = 'ck';
    grammar.aliases = ['contract-ck'];

    return createHighlighter({
        themes: ['dark-plus', 'light-plus'],
        langs: [grammar, 'typescript', 'python', 'json', 'bash', 'yaml'],
    });
}

/** One line of code as positioned, coloured runs. */
export interface Run {
    /** Column of the run's first character, in grid cells from the left edge of the code. */
    col: number;
    content: string;
    color: string;
    italic: boolean;
    bold: boolean;
}

export async function tokenize(code: string, lang: Lang, theme: ThemeName): Promise<Run[][]> {
    const highlighter = await getHighlighter();
    // `ck` is registered from the extension's grammar at runtime, so it is outside Shiki's
    // union of bundled language ids.
    const { tokens } = highlighter.codeToTokens(code, { lang: lang as 'typescript', theme });
    return tokens.map(toRuns);
}

function toRuns(line: ThemedToken[]): Run[] {
    const runs: Run[] = [];
    let col = 0;
    for (const token of line) {
        const width = Array.from(token.content).length;
        // Whitespace carries no ink; skipping it keeps the SVG small and avoids stretching a
        // run of spaces with textLength.
        if (token.content.trim() !== '') {
            const leading = token.content.length - token.content.trimStart().length;
            runs.push({
                col: col + leading,
                content: token.content.trim(),
                color: token.color ?? 'currentColor',
                italic: Boolean(token.fontStyle && token.fontStyle & 1),
                bold: Boolean(token.fontStyle && token.fontStyle & 2),
            });
        }
        col += width;
    }
    return runs;
}
