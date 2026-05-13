/**
 * Minimal tagged-template helper for building HTML strings with automatic escaping.
 *
 *     html`<p>${userInput}</p>`         // escapes userInput
 *     html`<ul>${raw(items.join(''))}</ul>`   // bypasses escaping
 *
 * Interpolations are coerced to strings and HTML-escaped. Arrays are joined without a separator
 * after escaping each element. `raw(...)` marks a string as pre-escaped so it passes through.
 */

const RAW = Symbol('raw');

interface RawHtml {
    [RAW]: true;
    value: string;
}

/** Marks a string as already-escaped HTML so the {@link html} tag inserts it verbatim. */
export function raw(value: string): RawHtml {
    return { [RAW]: true, value };
}

function isRaw(value: unknown): value is RawHtml {
    return typeof value === 'object' && value !== null && (value as { [RAW]?: boolean })[RAW] === true;
}

/** Escapes the five HTML-significant characters (`& < > " '`) so the input is safe to embed in markup. */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderValue(value: unknown): string {
    if (value === null || value === undefined || value === false) return '';
    if (isRaw(value)) return value.value;
    if (Array.isArray(value)) return value.map(renderValue).join('');
    return escapeHtml(String(value));
}

/**
 * Tagged template literal that auto-escapes every interpolated value. Use {@link raw} to inject
 * pre-built HTML without double-escaping. `null`, `undefined`, and `false` interpolations render
 * as empty strings; arrays are flattened and each element is escaped (or passed through if `raw`).
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
    let out = strings[0] ?? '';
    for (let i = 0; i < values.length; i++) {
        out += renderValue(values[i]) + (strings[i + 1] ?? '');
    }
    return out;
}

/** Slugify an arbitrary string for use in anchor ids — keeps a-z, 0-9, dashes; collapses everything else. */
export function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
