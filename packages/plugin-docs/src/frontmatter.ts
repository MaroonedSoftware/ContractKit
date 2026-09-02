/**
 * YAML frontmatter rendering, shared by every target that emits pages with a frontmatter block.
 *
 * Lives outside the targets because Mintlify and Docusaurus differ in which keys they read, not
 * in how a frontmatter block is written: both want scalars quoted the same way and both want a
 * missing value omitted rather than emitted as `null`.
 */

/** A scalar frontmatter value. Strings are quoted, numbers and `true` are written bare. */
export type FrontmatterScalar = string | number | boolean;

/**
 * A frontmatter entry's value. `undefined` and `false` are dropped, so an optional flag can be
 * passed unconditionally. A record renders as a nested block, which is how Docusaurus takes its
 * `mdx: { format: md }` opt-in.
 */
export type FrontmatterValue = FrontmatterScalar | undefined | Record<string, FrontmatterScalar>;

/** Render one scalar: strings JSON-quoted, numbers and booleans bare. */
function renderScalar(value: FrontmatterScalar): string {
    if (typeof value === 'string') return JSON.stringify(value);
    return String(value);
}

/**
 * Render a YAML frontmatter block. Strings are JSON-quoted so a title containing a colon,
 * a quote or a leading `@` stays valid YAML rather than becoming a parse error at build time.
 *
 * Nested records go one level deep, indented to the repo's four-space style — enough for the per-file options a docs
 * platform takes, and shallow enough that no key needs escaping beyond the scalar quoting above.
 */
export function frontmatter(entries: [string, FrontmatterValue][]): string {
    const lines = ['---'];
    for (const [key, value] of entries) {
        if (value === undefined || value === false) continue;
        if (typeof value === 'object') {
            const nested = Object.entries(value);
            if (nested.length === 0) continue;
            lines.push(`${key}:`);
            for (const [subKey, subValue] of nested) {
                lines.push(`    ${subKey}: ${renderScalar(subValue)}`);
            }
            continue;
        }
        lines.push(`${key}: ${renderScalar(value)}`);
    }
    lines.push('---');
    return lines.join('\n');
}

/** Frontmatter block plus an optional body, as a complete file with a trailing newline. */
export function page(front: string, body?: string): string {
    const trimmed = body?.trim();
    return trimmed ? `${front}\n\n${trimmed}\n` : `${front}\n`;
}
