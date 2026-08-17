import { tokenize, type Lang, type Run } from './highlighter.ts';
import type { Palette } from './palette.ts';
import { BASELINE, CHAR_W, FONT_SIZE, LINE_H, UI, cells, rect, round, squiggle, text } from './svg.ts';

/** Ghost text appended to the end of a line, as the inlay-hint provider produces. */
export interface InlayHint {
    /** 1-based line of the rendered snippet. */
    line: number;
    label: string;
}

/** A CodeLens row, drawn above its line the way VS Code inserts it. */
export interface CodeLens {
    line: number;
    label: string;
    /** Indent of the lens, in grid cells. Matches the declaration it sits above. */
    col?: number;
}

/** A squiggle plus the message VS Code shows in the Problems view. */
export interface Diagnostic {
    line: number;
    col: number;
    length: number;
    severity: 'error' | 'warning';
}

/** A floating hover / completion card anchored under a position in the code. */
export interface Card {
    line: number;
    col: number;
    /** Fenced code shown at the top of the card, highlighted with the real grammar. */
    code?: string;
    lang?: Lang;
    /** Prose rows under the code block. A leading `**` marks the row as emphasised. */
    body?: string[];
    /** Completion-style rows: an icon glyph, a label, and a dim detail column. */
    items?: { icon: string; label: string; detail?: string }[];
    widthCells?: number;
}

export interface EditorSpec {
    code: string;
    lang: Lang;
    /** Tab label. Omit to render the code with no tab bar. */
    filename?: string;
    lineNumbers?: boolean;
    /** Minimum grid columns for the code area. The longest line always wins. */
    columns?: number;
    /** Line number of the snippet's first line in its source file. Defaults to 1. */
    firstLine?: number;
    inlayHints?: InlayHint[];
    codeLenses?: CodeLens[];
    diagnostics?: Diagnostic[];
    cards?: Card[];
    /** Left-aligned status bar entries, as the extension contributes. */
    statusBar?: string[];
    /** Highlighted (selected) ranges. */
    selections?: { line: number; col: number; length: number }[];
}

const TAB_BAR_H = 36;
const STATUS_BAR_H = 24;
const CODE_PAD_TOP = 10;
const CODE_PAD_BOTTOM = 12;
const GUTTER_W = 46;
const CODE_PAD_LEFT = 12;
const LENS_H = 18;
const CARD_PAD = 10;

interface Row {
    kind: 'code' | 'lens';
    y: number;
    /** 1-based source line, for `code` rows. */
    line?: number;
    lens?: CodeLens;
}

export interface Rendered {
    elements: string[];
    width: number;
    height: number;
}

/**
 * Renders an editor pane: optional tab bar, gutter, highlighted code, and any overlays.
 *
 * The result is positioned from (0, 0); callers wrap it in a `<g transform>` to compose a
 * multi-pane window.
 */
export async function renderEditor(spec: EditorSpec, palette: Palette): Promise<Rendered> {
    const lines = await tokenize(spec.code.replace(/\n+$/, ''), spec.lang, palette.theme);
    const rawLines = spec.code.replace(/\n+$/, '').split('\n');
    // `columns` widens the pane; it never crops, or a figure could silently hide code.
    const columns = Math.max(spec.columns ?? 0, ...rawLines.map(cells), 40);

    const gutterW = spec.lineNumbers === false ? 0 : GUTTER_W;
    const codeX = gutterW + CODE_PAD_LEFT;
    const width = codeX + columns * CHAR_W + 24;

    const rows = layoutRows(rawLines.length, spec.codeLenses ?? [], spec.filename ? TAB_BAR_H + CODE_PAD_TOP : CODE_PAD_TOP);
    const lastRow = rows[rows.length - 1];
    const codeBottom = (lastRow ? lastRow.y + LINE_H : CODE_PAD_TOP) + CODE_PAD_BOTTOM;
    const height = codeBottom + (spec.statusBar ? STATUS_BAR_H : 0);

    const yOf = (line: number) => rows.find(row => row.kind === 'code' && row.line === line)?.y ?? 0;

    // Cards are laid out first because a hover or completion popup can hang below the last line
    // of code, and the pane's background has to be tall enough to sit behind it.
    const cards = await Promise.all((spec.cards ?? []).map(async card => ({ card, rendered: await renderCard(card, palette) })));
    const paneHeight = Math.max(height, ...cards.map(({ card, rendered }) => yOf(card.line) + LINE_H + 4 + rendered.height + 8));

    const elements: string[] = [rect({ x: 0, y: 0, w: width, h: paneHeight, fill: palette.editorBg })];

    if (spec.filename) elements.push(...renderTabBar(spec.filename, width, palette));

    for (const selection of spec.selections ?? []) {
        elements.push(
            rect({
                x: codeX + selection.col * CHAR_W,
                y: yOf(selection.line),
                w: selection.length * CHAR_W,
                h: LINE_H,
                fill: palette.selectionBg,
            }),
        );
    }

    for (const row of rows) {
        if (row.kind === 'lens' && row.lens) {
            elements.push(
                text({
                    x: codeX + (row.lens.col ?? 0) * CHAR_W,
                    y: row.y + 13,
                    content: row.lens.label,
                    fill: palette.codeLens,
                    fontSize: FONT_SIZE - 2,
                    fontFamily: UI,
                }),
            );
            continue;
        }
        const line = row.line ?? 1;
        if (gutterW > 0) {
            elements.push(
                text({
                    x: gutterW - 12,
                    y: row.y + BASELINE,
                    content: String(line + (spec.firstLine ?? 1) - 1),
                    fill: palette.lineNumber,
                    anchor: 'end',
                }),
            );
        }
        elements.push(...renderRuns(lines[line - 1] ?? [], codeX, row.y + BASELINE));
    }

    for (const hint of spec.inlayHints ?? []) {
        const col = cells(rawLines[hint.line - 1] ?? '') + 1;
        const w = cells(hint.label) * (CHAR_W - 0.6) + 10;
        elements.push(
            rect({ x: codeX + col * CHAR_W, y: yOf(hint.line) + 3, w, h: LINE_H - 6, rx: 3, fill: palette.inlayBg }),
            text({
                x: codeX + col * CHAR_W + 5,
                y: yOf(hint.line) + BASELINE,
                content: hint.label,
                fill: palette.inlayText,
                fontSize: FONT_SIZE - 1,
            }),
        );
    }

    for (const diagnostic of spec.diagnostics ?? []) {
        elements.push(
            squiggle(
                codeX + diagnostic.col * CHAR_W,
                yOf(diagnostic.line) + BASELINE + 3,
                diagnostic.length * CHAR_W,
                diagnostic.severity === 'error' ? palette.error : palette.warning,
            ),
        );
    }

    for (const { card, rendered } of cards) {
        const x = Math.max(Math.min(codeX + card.col * CHAR_W, width - rendered.width - 8), 8);
        const y = yOf(card.line) + LINE_H + 4;
        elements.push(`<g transform="translate(${round(x)}, ${round(y)})">`, ...rendered.elements, '</g>');
    }

    if (spec.statusBar) elements.push(...renderStatusBar(spec.statusBar, width, codeBottom, palette));

    return { elements, width, height: paneHeight };
}

function layoutRows(lineCount: number, lenses: CodeLens[], startY: number): Row[] {
    const rows: Row[] = [];
    let y = startY;
    for (let line = 1; line <= lineCount; line += 1) {
        for (const lens of lenses.filter(candidate => candidate.line === line)) {
            rows.push({ kind: 'lens', y, lens });
            y += LENS_H;
        }
        rows.push({ kind: 'code', y, line });
        y += LINE_H;
    }
    return rows;
}

function renderRuns(runs: Run[], x: number, baseline: number): string[] {
    return runs.map(run =>
        text({
            x: x + run.col * CHAR_W,
            y: baseline,
            content: run.content,
            fill: run.color,
            textLength: cells(run.content) * CHAR_W,
            fontStyle: run.italic ? 'italic' : 'normal',
            fontWeight: run.bold ? 'bold' : 'normal',
        }),
    );
}

function renderTabBar(filename: string, width: number, palette: Palette): string[] {
    const labelW = filename.length * 7 + 54;
    return [
        rect({ x: 0, y: 0, w: width, h: TAB_BAR_H, fill: palette.chromeBg }),
        rect({ x: 0, y: TAB_BAR_H - 1, w: width, h: 1, fill: palette.border }),
        rect({ x: 0, y: 0, w: labelW, h: TAB_BAR_H, fill: palette.activeTabBg }),
        rect({ x: 0, y: 0, w: labelW, h: 1, fill: palette.accent }),
        // The extension's file icon: a filled dot in the accent colour.
        `<circle cx="18" cy="${TAB_BAR_H / 2}" r="4" fill="${palette.accent}" />`,
        text({ x: 30, y: TAB_BAR_H / 2 + 4, content: filename, fill: palette.text, fontSize: FONT_SIZE, fontFamily: UI }),
    ];
}

function renderStatusBar(entries: string[], width: number, y: number, palette: Palette): string[] {
    const elements = [rect({ x: 0, y, w: width, h: STATUS_BAR_H, fill: palette.chromeBg }), rect({ x: 0, y, w: width, h: 1, fill: palette.border })];
    let x = 12;
    for (const entry of entries) {
        elements.push(text({ x, y: y + 16, content: entry, fill: palette.dimText, fontSize: FONT_SIZE - 1, fontFamily: UI }));
        x += entry.length * 6.6 + 18;
    }
    return elements;
}

async function renderCard(card: Card, palette: Palette): Promise<Rendered> {
    const elements: string[] = [];
    const codeLines = card.code ? card.code.replace(/\n+$/, '').split('\n') : [];
    const bodyLines = card.body ?? [];
    const items = card.items ?? [];

    const contentCells = Math.max(
        card.widthCells ?? 0,
        ...codeLines.map(cells),
        ...bodyLines.map(line => Math.round(cells(stripEmphasis(line)) * 0.82)),
        ...items.map(item => Math.round((cells(item.label) + cells(item.detail ?? '') + 6) * 0.9)),
        18,
    );
    const width = contentCells * CHAR_W + CARD_PAD * 2;

    const codeHeight = codeLines.length * LINE_H;
    let y = CARD_PAD + codeHeight;
    if (codeLines.length > 0 && (bodyLines.length > 0 || items.length > 0)) y += 8;
    const dividerY = codeLines.length > 0 && (bodyLines.length > 0 || items.length > 0) ? y - 4 : undefined;
    y += bodyLines.length * LINE_H;
    y += items.length * (LINE_H + 2);
    const height = y + CARD_PAD - 4;

    elements.push(
        rect({ x: 2, y: 3, w: width, h: height, rx: 6, fill: '#000000', opacity: 0.16 }),
        rect({ x: 0, y: 0, w: width, h: height, rx: 6, fill: palette.cardBg, stroke: palette.cardBorder }),
    );

    let cursor = CARD_PAD;
    if (codeLines.length > 0) {
        const highlighted = await tokenize(codeLines.join('\n'), card.lang ?? 'ck', palette.theme);
        for (const runs of highlighted) {
            elements.push(...renderRuns(runs, CARD_PAD, cursor + BASELINE));
            cursor += LINE_H;
        }
    }
    if (dividerY !== undefined) {
        elements.push(rect({ x: 0, y: CARD_PAD + codeHeight + 4, w: width, h: 1, fill: palette.cardBorder }));
        cursor += 8;
    }
    for (const line of bodyLines) {
        const emphasised = line.startsWith('**');
        elements.push(
            text({
                x: CARD_PAD,
                y: cursor + BASELINE,
                content: stripEmphasis(line),
                fill: emphasised ? palette.text : palette.dimText,
                fontSize: FONT_SIZE - 1,
                fontFamily: UI,
                fontWeight: emphasised ? 'bold' : 'normal',
            }),
        );
        cursor += LINE_H;
    }
    for (const item of items) {
        elements.push(
            text({ x: CARD_PAD, y: cursor + BASELINE, content: item.icon, fill: palette.accent, fontSize: FONT_SIZE }),
            text({ x: CARD_PAD + 20, y: cursor + BASELINE, content: item.label, fill: palette.text, fontSize: FONT_SIZE, fontFamily: UI }),
        );
        if (item.detail) {
            elements.push(
                text({
                    x: width - CARD_PAD,
                    y: cursor + BASELINE,
                    content: item.detail,
                    fill: palette.dimText,
                    fontSize: FONT_SIZE - 1,
                    fontFamily: UI,
                    anchor: 'end',
                }),
            );
        }
        cursor += LINE_H + 2;
    }

    return { elements, width, height };
}

function stripEmphasis(line: string): string {
    return line.replace(/^\*\*/, '').replace(/\*\*$/, '');
}
