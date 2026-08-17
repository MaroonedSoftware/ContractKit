import type { Palette } from './palette.ts';
import type { Rendered } from './editor.ts';
import { FONT_SIZE, UI, path, rect, round, text } from './svg.ts';

interface Output {
    label: string;
    detail: string;
    color: string;
}

const OUTPUTS: Output[] = [
    { label: 'Zod schemas', detail: 'runtime validation', color: '#4EC9B0' },
    { label: 'Koa router', detail: 'typed handlers', color: '#569CD6' },
    { label: 'TypeScript SDK', detail: 'one client per area', color: '#DCDCAA' },
    { label: 'Python SDK', detail: 'Pydantic v2 + httpx', color: '#C586C0' },
    { label: 'OpenAPI 3.1', detail: 'openapi.yaml', color: '#CE9178' },
    { label: 'Markdown docs', detail: 'api-reference.md', color: '#9CDCFE' },
    { label: 'Bruno collection', detail: 'ready to send', color: '#B5CEA8' },
    { label: 'MCP tools', detail: 'agent-callable', color: '#4FC1FF' },
];

const CARD_W = 210;
const CARD_H = 46;
const GAP = 12;
const SOURCE_W = 190;
const SOURCE_H = 74;
const COLUMN_GAP = 96;
const PAD = 20;

/** Rows per output column. Two columns keep the figure close to a README's aspect ratio. */
const ROWS = 4;

/** The "one file in, eight artefacts out" figure that opens the README. */
export function renderPipeline(palette: Palette): Rendered {
    const columnH = ROWS * CARD_H + (ROWS - 1) * GAP;
    const height = columnH + PAD * 2;
    const width = PAD + SOURCE_W + COLUMN_GAP + CARD_W * 2 + GAP + PAD;

    const sourceX = PAD;
    const sourceY = (height - SOURCE_H) / 2;
    const cardX = PAD + SOURCE_W + COLUMN_GAP;

    const elements: string[] = [
        rect({ x: 0, y: 0, w: width, h: height, fill: palette.editorBg }),
        rect({ x: sourceX, y: sourceY, w: SOURCE_W, h: SOURCE_H, rx: 8, fill: palette.chromeBg, stroke: palette.accent }),
        text({
            x: sourceX + SOURCE_W / 2,
            y: sourceY + 30,
            content: 'subscriptions.ck',
            fill: palette.text,
            fontSize: FONT_SIZE + 1,
            anchor: 'middle',
        }),
        text({
            x: sourceX + SOURCE_W / 2,
            y: sourceY + 52,
            content: 'the source of truth',
            fill: palette.dimText,
            fontSize: FONT_SIZE - 2,
            fontFamily: UI,
            anchor: 'middle',
        }),
    ];

    const fanX = sourceX + SOURCE_W + COLUMN_GAP / 2;
    const fanY = sourceY + SOURCE_H / 2;
    elements.push(path(`M ${sourceX + SOURCE_W} ${round(fanY)} H ${round(fanX)}`, palette.frame, 1.5));

    for (const [index, output] of OUTPUTS.entries()) {
        const column = Math.floor(index / ROWS);
        const x = cardX + column * (CARD_W + GAP);
        const y = PAD + (index % ROWS) * (CARD_H + GAP);
        const midY = y + CARD_H / 2;
        // Only the first column is wired to the fan-out; a second set of connectors crossing the
        // first would add ink without adding meaning.
        if (column === 0) {
            elements.push(
                path(
                    `M ${round(fanX)} ${round(fanY)} C ${round(fanX + 30)} ${round(fanY)}, ${round(cardX - 34)} ${round(midY)}, ${round(cardX)} ${round(midY)}`,
                    palette.frame,
                    1.5,
                ),
            );
        }
        elements.push(
            rect({ x, y, w: CARD_W, h: CARD_H, rx: 6, fill: palette.chromeBg, stroke: palette.border }),
            rect({ x, y: y + 8, w: 3, h: CARD_H - 16, rx: 1.5, fill: output.color }),
            text({ x: x + 16, y: y + 20, content: output.label, fill: palette.text, fontSize: FONT_SIZE - 1, fontFamily: UI }),
            text({ x: x + 16, y: y + 36, content: output.detail, fill: palette.dimText, fontSize: FONT_SIZE - 3, fontFamily: UI }),
        );
    }

    return { elements, width, height };
}
