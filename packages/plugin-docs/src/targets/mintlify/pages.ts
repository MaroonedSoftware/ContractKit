import { resolveModifiers } from '@contractkit/core';
import type { EndpointEntry, ModelEntry } from '../../naming.js';

/**
 * MDX page rendering for Mintlify.
 *
 * Pages are deliberately thin. Mintlify renders parameters, request and response schemas, and
 * the interactive playground from the OpenAPI document the frontmatter points at, so duplicating
 * any of that in MDX would only create a second thing to keep in sync.
 */

/** Frontmatter entry. A `false` value is dropped, so optional flags can be passed unconditionally. */
type FrontmatterValue = string | boolean | undefined;

/**
 * Render a YAML frontmatter block. Strings are JSON-quoted so a title containing a colon,
 * a quote or a leading `@` stays valid YAML rather than becoming a parse error at build time.
 */
function frontmatter(entries: [string, FrontmatterValue][]): string {
    const lines = ['---'];
    for (const [key, value] of entries) {
        if (value === undefined || value === false) continue;
        lines.push(`${key}: ${value === true ? 'true' : JSON.stringify(value)}`);
    }
    lines.push('---');
    return lines.join('\n');
}

/** Frontmatter block plus an optional body, as a complete file with a trailing newline. */
function page(front: string, body?: string): string {
    const trimmed = body?.trim();
    return trimmed ? `${front}\n\n${trimmed}\n` : `${front}\n`;
}

/**
 * One endpoint page.
 *
 * `specPath` is the OpenAPI document's docs-root-relative path (e.g. `/openapi.yaml`); Mintlify
 * resolves the `<spec> <METHOD> <path>` triple against it to find the operation to render.
 */
export function renderEndpointPage(entry: EndpointEntry, specPath: string): string {
    const { op, route, title } = entry;
    const deprecated = resolveModifiers(route, op).includes('deprecated');
    const front = frontmatter([
        ['title', title],
        ['sidebarTitle', title],
        ['openapi', `${specPath} ${op.method.toUpperCase()} ${route.path}`],
        ['deprecated', deprecated],
    ]);
    return page(front, op.description);
}

/** One model page, rendered by Mintlify from the named schema in `components.schemas`. */
export function renderModelPage(entry: ModelEntry, specPath: string): string {
    const { model, title } = entry;
    const front = frontmatter([
        ['title', title],
        ['openapi-schema', `${specPath} ${model.name}`],
        ['deprecated', model.deprecated === true],
    ]);
    return page(front, model.description);
}

/**
 * Starter landing page. Written once and then owned by the user, so it says as little as
 * possible: anything opinionated here would be something they have to delete.
 */
export function renderIndexPage(siteName: string): string {
    const front = frontmatter([
        ['title', siteName],
        ['description', `API reference for ${siteName}.`],
    ]);
    return page(
        front,
        [
            `Welcome to the ${siteName} documentation.`,
            '',
            'This page is yours to edit — it is created once and never overwritten. The API reference',
            'pages alongside it are generated from the contracts on every build.',
        ].join('\n'),
    );
}
