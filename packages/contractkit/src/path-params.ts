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
