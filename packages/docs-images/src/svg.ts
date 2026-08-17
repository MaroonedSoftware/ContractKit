/**
 * Minimal SVG builders.
 *
 * Every figure in this package is viewed on GitHub, where SVGs are loaded through an `<img>`
 * tag. That rules out two things a normal SVG could rely on: `<style>` blocks with CSS classes
 * (GitHub's sanitizer strips them) and webfonts (an `<img>`-rendered SVG cannot load one). So
 * everything here emits presentation attributes only, and all text is positioned on a fixed
 * character grid with `textLength` so it stays aligned whichever monospace font the reader's
 * machine actually resolves.
 */

/** Font stack for code. Every entry is a font that ships with a mainstream OS. */
export const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** Font stack for editor chrome (tabs, tree labels, status bar). */
export const UI = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Ubuntu, Cantarell, sans-serif";

/** Code metrics. `CHAR_W` is 0.6em, the advance width of every mainstream monospace face. */
export const FONT_SIZE = 13;
export const CHAR_W = FONT_SIZE * 0.6;
export const LINE_H = 20;

/** Vertical offset from a row's top edge to the text baseline. */
export const BASELINE = 14;

export function esc(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Character count as cells on the monospace grid, counting astral characters once. */
export function cells(value: string): number {
    return Array.from(value).length;
}

export interface RectOptions {
    x: number;
    y: number;
    w: number;
    h: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    rx?: number;
    opacity?: number;
}

export function rect({ x, y, w, h, fill, stroke, strokeWidth = 1, rx, opacity }: RectOptions): string {
    const attrs = [`x="${round(x)}"`, `y="${round(y)}"`, `width="${round(w)}"`, `height="${round(h)}"`];
    if (rx !== undefined) attrs.push(`rx="${rx}"`);
    attrs.push(`fill="${fill ?? 'none'}"`);
    if (stroke) attrs.push(`stroke="${stroke}"`, `stroke-width="${strokeWidth}"`);
    if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
    return `<rect ${attrs.join(' ')} />`;
}

export interface TextOptions {
    x: number;
    y: number;
    content: string;
    fill: string;
    /** Pin the run to an exact width. Used for code so the character grid never drifts. */
    textLength?: number;
    fontSize?: number;
    fontFamily?: string;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    opacity?: number;
    anchor?: 'start' | 'middle' | 'end';
}

export function text({
    x,
    y,
    content,
    fill,
    textLength,
    fontSize = FONT_SIZE,
    fontFamily = MONO,
    fontWeight = 'normal',
    fontStyle = 'normal',
    opacity,
    anchor,
}: TextOptions): string {
    const attrs = [`x="${round(x)}"`, `y="${round(y)}"`, `fill="${fill}"`, `font-family="${fontFamily}"`, `font-size="${fontSize}"`];
    if (fontWeight !== 'normal') attrs.push(`font-weight="${fontWeight}"`);
    if (fontStyle !== 'normal') attrs.push(`font-style="${fontStyle}"`);
    if (anchor) attrs.push(`text-anchor="${anchor}"`);
    if (opacity !== undefined) attrs.push(`opacity="${opacity}"`);
    if (textLength !== undefined) attrs.push(`textLength="${round(textLength)}"`, 'lengthAdjust="spacingAndGlyphs"');
    attrs.push('xml:space="preserve"');
    return `<text ${attrs.join(' ')}>${esc(content)}</text>`;
}

export function path(d: string, stroke: string, strokeWidth = 1, fill = 'none'): string {
    return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
}

/** A wavy underline, as VS Code draws under a diagnostic range. */
export function squiggle(x: number, y: number, width: number, color: string): string {
    const step = 3;
    const segments: string[] = [`M ${round(x)} ${round(y)}`];
    for (let offset = 0; offset < width; offset += step * 2) {
        segments.push(`q ${step / 2} -3 ${step} 0`, `q ${step / 2} 3 ${step} 0`);
    }
    return path(segments.join(' '), color, 1.2);
}

/** Wraps children in a document. `title` becomes the accessible name of the whole figure. */
export function document_(width: number, height: number, title: string, body: string[]): string {
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${round(width)}" height="${round(height)}" viewBox="0 0 ${round(width)} ${round(height)}" role="img" aria-label="${esc(title)}">`,
        `<title>${esc(title)}</title>`,
        ...body,
        '</svg>',
        '',
    ].join('\n');
}

export function round(value: number): number {
    return Math.round(value * 100) / 100;
}
