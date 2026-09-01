/**
 * The `{name}` placeholders in a route path.
 *
 * Five generators used to carry their own regex for this, and they disagreed: `\w+` in the core
 * validators and the Koa router, `[a-zA-Z_][a-zA-Z0-9_]*` in Bruno, and a wider pattern in the
 * TypeScript SDK. A name the grammar accepts but a consumer's regex does not is not a parse error
 * anywhere — the placeholder is simply left alone, so the braces travel into the emitted output
 * and nothing reports it. `{payment-id}` did exactly that.
 */

/**
 * Matches one `{name}` placeholder, capturing the name.
 *
 * The name is `identStart identPart*`, as `contractkit.ohm` defines an identifier: a letter, `_`
 * or `$` to start, then also digits, `-` and `.`. Non-global so `.test` is safe to call
 * repeatedly; use {@link PATH_PARAM_RE_G} to iterate or replace.
 */
export const PATH_PARAM_RE = /\{([a-zA-Z_$][a-zA-Z0-9_$.-]*)\}/;

/** Global-flagged {@link PATH_PARAM_RE}, for `replace` and `matchAll`. */
export const PATH_PARAM_RE_G = /\{([a-zA-Z_$][a-zA-Z0-9_$.-]*)\}/g;

/** The placeholder names in a route path, in order, e.g. `/users/{id}/posts` → `['id']`. */
export function extractPathParams(path: string): string[] {
    return [...path.matchAll(PATH_PARAM_RE_G)].map(m => m[1]!);
}

/** Whether a route path declares any placeholder at all. */
export function hasPathParams(path: string): boolean {
    return PATH_PARAM_RE.test(path);
}

/**
 * Derive a name that can be an identifier — in TypeScript, in a Koa route pattern, in a Bruno
 * `:variable` — from a name the `.ck` grammar accepts.
 *
 * Returns the name unchanged when it already qualifies, which is the overwhelmingly common case
 * and keeps existing generated output byte-identical. Otherwise separators are dropped and the
 * following segment capitalised, so `payment-id` becomes `paymentId`.
 *
 * Use for names generated code has to *bind*: a path parameter, which reaches a handler through a
 * route pattern the generator authors, or an MCP tool argument, whose schema the generator
 * publishes. Never for a name that travels on the wire — a query parameter, a header, or an
 * OpenAPI parameter matching its own path template keeps its declared spelling.
 *
 * Python has its own convention (`toPythonFieldName`, snake_case) and does not use this.
 */
export function toIdentifier(name: string): string {
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) return name;

    const parts = name.split(/[^a-zA-Z0-9_$]+/).filter(Boolean);
    const joined = parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
    if (joined === '') return '_';
    return /^[0-9]/.test(joined) ? `_${joined}` : joined;
}
