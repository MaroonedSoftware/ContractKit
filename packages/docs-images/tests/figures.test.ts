import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FIGURES } from '../src/figures.ts';
import { CK_GRAMMAR_PATH, tokenize } from '../src/highlighter.ts';
import { DARK, LIGHT, PALETTES } from '../src/palette.ts';
import { document_ } from '../src/svg.ts';
import { frame } from '../src/window.ts';

async function render(figure: (typeof FIGURES)[number], palette = DARK): Promise<string> {
    const framed = frame(await figure.build(palette), palette, `${figure.name}-clip`);
    return document_(framed.width, framed.height, figure.title, framed.elements);
}

describe('figure rendering', () => {
    for (const figure of FIGURES) {
        for (const palette of PALETTES) {
            it(`renders ${figure.name} (${palette.suffix})`, async () => {
                const svg = await render(figure, palette);
                expect(svg.startsWith('<svg')).toBe(true);
                expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
                expect(svg).toContain(`<title>${figure.title.replace(/&/g, '&amp;')}</title>`);
            });
        }
    }

    /**
     * GitHub is where these are read, and it loads them through an `<img>` tag: a `<style>` block
     * is stripped by its sanitizer, a `class` attribute has nothing to bind to, and `@font-face`
     * cannot fetch anything. Any of the three would silently render an unstyled figure for every
     * reader while looking perfect locally.
     */
    it('emits nothing GitHub would strip or fail to load', async () => {
        for (const figure of FIGURES) {
            const svg = await render(figure);
            expect(svg, figure.name).not.toContain('<style');
            expect(svg, figure.name).not.toContain('class=');
            expect(svg, figure.name).not.toContain('@font-face');
            expect(svg, figure.name).not.toContain('<script');
            // A URL inside a code sample is fine; one an attribute would fetch is not.
            expect(svg, figure.name).not.toMatch(/(?:href|src)="https?:\/\//);
            expect(svg, figure.name).not.toMatch(/url\(\s*['"]?https?:\/\//);
        }
    });

    it('pins every code run to the character grid', async () => {
        const svg = await render(FIGURES.find(figure => figure.name === 'hero')!);
        const codeRuns = svg.match(/<text [^>]*font-family="ui-monospace[^>]*>/g) ?? [];
        expect(codeRuns.length).toBeGreaterThan(50);
        expect(codeRuns.every(run => run.includes('textLength='))).toBe(true);
    });

    it('renders byte-identical output on a second pass', async () => {
        const figure = FIGURES.find(f => f.name === 'vscode-preview')!;
        expect(await render(figure)).toBe(await render(figure));
    });

    it('distinguishes the dark and light themes', async () => {
        const figure = FIGURES.find(f => f.name === 'hero')!;
        expect(await render(figure, DARK)).not.toBe(await render(figure, LIGHT));
    });

    it('gives each figure a document-unique clip id', () => {
        expect(new Set(FIGURES.map(figure => figure.name)).size).toBe(FIGURES.length);
    });
});

describe('the ck grammar behind the figures', () => {
    /**
     * The figures exist to show what the editor does, which only holds while they are coloured by
     * the extension's actual grammar. If that file moves or is renamed, fail here rather than
     * quietly falling back to plain text.
     */
    it("is the extension's own TextMate grammar", () => {
        const grammar = JSON.parse(readFileSync(CK_GRAMMAR_PATH, 'utf8'));
        expect(CK_GRAMMAR_PATH).toContain('apps/vscode-extension/syntaxes/ck.tmLanguage.json');
        expect(grammar.scopeName).toBe('source.ck');
    });

    it('colours keywords, model names, modifiers, and scalars distinctly', async () => {
        const [declaration, field] = await tokenize('contract Pet: {\n    id: readonly uuid\n}', 'ck', 'dark-plus');

        const colorOf = (runs: typeof declaration, content: string) => runs!.find(run => run.content === content)?.color;
        const keyword = colorOf(declaration, 'contract');
        const model = colorOf(declaration, 'Pet');
        const modifier = colorOf(field, 'readonly');
        const scalar = colorOf(field, 'uuid');

        for (const color of [keyword, model, modifier, scalar]) expect(color).toMatch(/^#[0-9A-F]{6}$/i);
        expect(keyword).not.toBe(model);
        expect(modifier).not.toBe(model);
        expect(modifier).not.toBe(keyword);
        // Dark+ paints a model reference and a built-in scalar the same green; that is the
        // theme's call, not the grammar's, so it is not asserted apart.
    });

    it('highlights the built-in scalar types', async () => {
        const [line] = await tokenize('contract Id: uuid', 'ck', 'dark-plus');
        expect(line!.map(run => run.content)).toContain('uuid');
    });
});
