/**
 * Directory handling shared by the multi-page targets, so a configured `apiDir` of `''`,
 * `'api'` or `'/api/'` resolves the same way whichever target reads it.
 */

/** Strip leading and trailing slashes so a configured directory joins predictably. */
export function normalizeDir(value: string): string {
    return value.replace(/^\/+|\/+$/g, '');
}
