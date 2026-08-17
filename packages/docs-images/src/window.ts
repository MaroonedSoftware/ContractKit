import { renderEditor, type EditorSpec, type Rendered } from './editor.ts';
import type { Palette } from './palette.ts';
import { CHAR_W, FONT_SIZE, UI, cells, rect, round, text } from './svg.ts';

/** One row of the ContractKit Explorer tree. */
export interface TreeItem {
    depth: number;
    label: string;
    /** HTTP verb badge, for operation rows. */
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DEL';
    /** Twisty state for group rows. */
    expanded?: boolean;
    /** Dim trailing text, e.g. an SDK method name. */
    detail?: string;
    selected?: boolean;
    /** Warning count badge, as the tree shows per group. */
    warnings?: number;
}

export interface Sidebar {
    title: string;
    items: TreeItem[];
    widthPx?: number;
}

/** A row in the API preview panel: a label, a value, and an optional type-coloured value. */
export interface PanelRow {
    label: string;
    value?: string;
    dim?: string;
}

export interface PanelSection {
    heading: string;
    rows?: PanelRow[];
    /** Status rows, rendered with a coloured status pill. */
    statuses?: { code: string; label: string; kind: 'ok' | 'error' }[];
}

export interface Panel {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DEL';
    route: string;
    subtitle?: string;
    sections: PanelSection[];
    widthPx?: number;
}

export interface WindowSpec {
    /** Window title bar label. Omit for a bare pane. */
    title?: string;
    sidebar?: Sidebar;
    editor?: EditorSpec;
    panel?: Panel;
    statusBar?: string[];
}

const TITLE_BAR_H = 34;
const STATUS_BAR_H = 24;
const SECTION_HEADER_H = 26;
const ROW_H = 22;

const METHOD_COLORS: Record<string, string> = {
    GET: '#4EC9B0',
    POST: '#569CD6',
    PUT: '#CE9178',
    PATCH: '#C586C0',
    DEL: '#F14C4C',
};

/** Composes a VS Code-shaped window from an optional sidebar, editor pane, and preview panel. */
export async function renderWindow(spec: WindowSpec, palette: Palette): Promise<Rendered> {
    const editor = spec.editor ? await renderEditor({ ...spec.editor, statusBar: undefined }, palette) : undefined;
    const sidebarW = spec.sidebar ? (spec.sidebar.widthPx ?? 250) : 0;
    const panelW = spec.panel ? (spec.panel.widthPx ?? 330) : 0;

    const bodyH = Math.max(editor?.height ?? 0, spec.sidebar ? sidebarHeight(spec.sidebar) : 0, spec.panel ? panelHeight(spec.panel) : 0);
    const width = sidebarW + (editor?.width ?? 0) + panelW;
    const titleH = spec.title ? TITLE_BAR_H : 0;
    const statusH = spec.statusBar ? STATUS_BAR_H : 0;
    const height = titleH + bodyH + statusH;

    const elements: string[] = [rect({ x: 0, y: 0, w: width, h: height, fill: palette.editorBg })];

    if (spec.title) elements.push(...renderTitleBar(spec.title, width, palette));

    let x = 0;
    if (spec.sidebar) {
        elements.push(`<g transform="translate(0, ${titleH})">`, ...renderSidebar(spec.sidebar, sidebarW, bodyH, palette), '</g>');
        x += sidebarW;
    }
    if (editor) {
        elements.push(
            rect({ x, y: titleH, w: editor.width, h: bodyH, fill: palette.editorBg }),
            `<g transform="translate(${round(x)}, ${titleH})">`,
            ...editor.elements,
            '</g>',
        );
        x += editor.width;
    }
    if (spec.panel) {
        elements.push(`<g transform="translate(${round(x)}, ${titleH})">`, ...renderPanel(spec.panel, panelW, bodyH, palette), '</g>');
    }

    if (spec.statusBar) {
        const y = titleH + bodyH;
        elements.push(rect({ x: 0, y, w: width, h: STATUS_BAR_H, fill: palette.chromeBg }), rect({ x: 0, y, w: width, h: 1, fill: palette.border }));
        let entryX = 12;
        for (const [index, entry] of spec.statusBar.entries()) {
            elements.push(
                text({
                    x: entryX,
                    y: y + 16,
                    content: entry,
                    fill: index === 0 ? palette.text : palette.dimText,
                    fontSize: FONT_SIZE - 1,
                    fontFamily: UI,
                }),
            );
            entryX += entry.length * 6.6 + 20;
        }
    }

    return { elements, width, height };
}

/** Wraps a rendered figure in a rounded, clipped border so it reads as a window on any page. */
export function frame(rendered: Rendered, palette: Palette, id: string): Rendered {
    const { width, height } = rendered;
    return {
        width,
        height,
        elements: [
            `<defs><clipPath id="${id}"><rect x="0" y="0" width="${round(width)}" height="${round(height)}" rx="8" /></clipPath></defs>`,
            rect({ x: 0, y: 0, w: width, h: height, rx: 8, fill: palette.editorBg }),
            `<g clip-path="url(#${id})">`,
            ...rendered.elements,
            '</g>',
            rect({ x: 0.5, y: 0.5, w: width - 1, h: height - 1, rx: 8, stroke: palette.frame }),
        ],
    };
}

function renderTitleBar(title: string, width: number, palette: Palette): string[] {
    return [
        rect({ x: 0, y: 0, w: width, h: TITLE_BAR_H, fill: palette.chromeBg }),
        rect({ x: 0, y: TITLE_BAR_H - 1, w: width, h: 1, fill: palette.border }),
        `<circle cx="18" cy="17" r="5" fill="#FF5F57" />`,
        `<circle cx="36" cy="17" r="5" fill="#FEBC2E" />`,
        `<circle cx="54" cy="17" r="5" fill="#28C840" />`,
        text({ x: width / 2, y: 21, content: title, fill: palette.dimText, fontSize: FONT_SIZE - 1, fontFamily: UI, anchor: 'middle' }),
    ];
}

function sidebarHeight(sidebar: Sidebar): number {
    return SECTION_HEADER_H + sidebar.items.length * ROW_H + 16;
}

function renderSidebar(sidebar: Sidebar, width: number, height: number, palette: Palette): string[] {
    const elements = [
        rect({ x: 0, y: 0, w: width, h: height, fill: palette.chromeBg }),
        rect({ x: width - 1, y: 0, w: 1, h: height, fill: palette.border }),
        text({ x: 14, y: 18, content: sidebar.title.toUpperCase(), fill: palette.dimText, fontSize: 11, fontFamily: UI, fontWeight: 'bold' }),
    ];

    let y = SECTION_HEADER_H;
    for (const item of sidebar.items) {
        const x = 10 + item.depth * 14;
        if (item.selected) elements.push(rect({ x: 0, y, w: width, h: ROW_H, fill: palette.selectionBg, opacity: 0.55 }));
        let labelX = x;
        if (item.expanded !== undefined) {
            elements.push(text({ x, y: y + 15, content: item.expanded ? '⌄' : '›', fill: palette.dimText, fontSize: FONT_SIZE, fontFamily: UI }));
            labelX += 14;
        }
        if (item.method) {
            elements.push(
                text({
                    x: labelX,
                    y: y + 15,
                    content: item.method,
                    fill: METHOD_COLORS[item.method] ?? palette.accent,
                    fontSize: 10,
                    fontWeight: 'bold',
                }),
            );
            labelX += 30;
        }
        elements.push(text({ x: labelX, y: y + 15, content: item.label, fill: palette.text, fontSize: FONT_SIZE - 1, fontFamily: UI }));
        if (item.detail) {
            elements.push(
                text({
                    x: labelX + item.label.length * 6.4 + 8,
                    y: y + 15,
                    content: item.detail,
                    fill: palette.dimText,
                    fontSize: FONT_SIZE - 2,
                    fontFamily: UI,
                }),
            );
        }
        if (item.warnings) {
            elements.push(
                rect({ x: width - 32, y: y + 4, w: 20, h: 14, rx: 7, fill: palette.warning, opacity: 0.85 }),
                text({
                    x: width - 22,
                    y: y + 14.5,
                    content: String(item.warnings),
                    fill: '#1F1F1F',
                    fontSize: 10,
                    fontFamily: UI,
                    fontWeight: 'bold',
                    anchor: 'middle',
                }),
            );
        }
        y += ROW_H;
    }
    return elements;
}

function panelHeight(panel: Panel): number {
    let height = 58;
    for (const section of panel.sections) {
        height += SECTION_HEADER_H + (section.rows?.length ?? 0) * ROW_H + (section.statuses?.length ?? 0) * ROW_H + 8;
    }
    return height + 12;
}

function renderPanel(panel: Panel, width: number, height: number, palette: Palette): string[] {
    const elements = [
        rect({ x: 0, y: 0, w: width, h: height, fill: palette.editorBg }),
        rect({ x: 0, y: 0, w: 1, h: height, fill: palette.border }),
        methodBadge(16, 16, panel.method, palette),
        text({ x: 16 + badgeWidth(panel.method) + 10, y: 28, content: panel.route, fill: palette.text, fontSize: FONT_SIZE + 1 }),
    ];

    let y = 48;
    if (panel.subtitle) {
        elements.push(text({ x: 16, y: y + 8, content: panel.subtitle, fill: palette.dimText, fontSize: FONT_SIZE - 1, fontFamily: UI }));
        y += 22;
    }

    for (const section of panel.sections) {
        elements.push(
            text({
                x: 16,
                y: y + 16,
                content: section.heading.toUpperCase(),
                fill: palette.dimText,
                fontSize: 10,
                fontFamily: UI,
                fontWeight: 'bold',
            }),
        );
        y += SECTION_HEADER_H;
        for (const row of section.rows ?? []) {
            elements.push(text({ x: 16, y: y + 15, content: row.label, fill: palette.text, fontSize: FONT_SIZE - 1 }));
            if (row.value) {
                elements.push(
                    text({ x: 16 + cells(row.label) * CHAR_W + 10, y: y + 15, content: row.value, fill: '#4EC9B0', fontSize: FONT_SIZE - 1 }),
                );
            }
            if (row.dim) {
                elements.push(
                    text({
                        x: width - 16,
                        y: y + 15,
                        content: row.dim,
                        fill: palette.dimText,
                        fontSize: FONT_SIZE - 2,
                        fontFamily: UI,
                        anchor: 'end',
                    }),
                );
            }
            y += ROW_H;
        }
        for (const status of section.statuses ?? []) {
            const color = status.kind === 'ok' ? palette.added : palette.error;
            elements.push(
                rect({ x: 16, y: y + 2, w: 34, h: 17, rx: 4, fill: color, opacity: 0.16 }),
                text({ x: 33, y: y + 15, content: status.code, fill: color, fontSize: FONT_SIZE - 2, fontWeight: 'bold', anchor: 'middle' }),
                text({ x: 60, y: y + 15, content: status.label, fill: palette.text, fontSize: FONT_SIZE - 1 }),
            );
            y += ROW_H;
        }
        y += 8;
    }
    return elements;
}

function badgeWidth(method: string): number {
    return method.length * 7 + 14;
}

function methodBadge(x: number, y: number, method: string, palette: Palette): string {
    const color = METHOD_COLORS[method] ?? palette.accent;
    const w = badgeWidth(method);
    return [
        rect({ x, y, w, h: 18, rx: 4, fill: color, opacity: 0.18 }),
        text({ x: x + w / 2, y: y + 13, content: method, fill: color, fontSize: 11, fontWeight: 'bold', fontFamily: UI, anchor: 'middle' }),
    ].join('');
}
