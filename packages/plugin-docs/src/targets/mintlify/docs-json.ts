import type { MintlifyConfig } from '../../target.js';
import type { EndpointGroup, ModelGroup } from '../../naming.js';

/**
 * `docs.json` — Mintlify's site config and navigation.
 *
 * Regenerated on every build rather than scaffolded once, so navigation cannot drift from the
 * contracts when an endpoint is added or removed. Anything the user wants to keep (theme,
 * colors, hand-written tabs and groups) goes in the plugin's `docs` config and is merged in
 * here, which keeps it in one place instead of split between a config file and a generated one.
 */

/**
 * A Mintlify navigation group: a sidebar section listing page paths.
 *
 * A nested group is an *element of `pages`*, not a sibling key — that is the shape Mintlify's
 * schema defines, and a `groups` key alongside `pages` would simply be ignored.
 */
export interface NavGroup {
    group: string;
    pages: (string | NavGroup)[];
}

/** A Mintlify navigation tab, holding groups. */
export interface NavTab {
    tab: string;
    groups: NavGroup[];
}

/** Inputs the navigation is built from. */
export interface DocsJsonContext {
    config: MintlifyConfig;
    /** Endpoint page directory, relative to the docs root. */
    apiDir: string;
    /** Model page directory, relative to the docs root. */
    modelsDir: string;
    groups: EndpointGroup[];
    models: ModelGroup[];
    /** Whether an `index.mdx` exists to link from the Overview group. */
    hasIndex: boolean;
}

const SCHEMA_URL = 'https://mintlify.com/docs.json';
const DEFAULT_THEME = 'mint';
const DEFAULT_PRIMARY = '#0D9373';
const DEFAULT_TAB = 'API Reference';

/** Plain-object check that excludes arrays and null, both of which merge as values. */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The generated groups: an Overview, one per endpoint area, then Models. */
function buildGroups(ctx: DocsJsonContext): NavGroup[] {
    const groups: NavGroup[] = [];

    if (ctx.hasIndex) {
        groups.push({ group: 'Overview', pages: ['index'] });
    }

    for (const group of ctx.groups) {
        if (group.endpoints.length === 0) continue;
        groups.push({
            group: group.title,
            pages: group.endpoints.map(e => `${ctx.apiDir}/${group.slug}/${e.slug}`),
        });
    }

    const modelPages = buildModelPages(ctx);
    if (modelPages.length > 0) {
        groups.push({ group: 'Models', pages: modelPages });
    }

    return groups;
}

/**
 * The contents of the Models group.
 *
 * Models carrying an `area` become a nested, collapsed subgroup each; area-less models sit
 * directly in the Models group. A schema list that runs to hundreds of entries is unusable as
 * one flat sidebar section, and area is the same axis the endpoints are already grouped on.
 */
function buildModelPages(ctx: DocsJsonContext): (string | NavGroup)[] {
    const pages: (string | NavGroup)[] = [];

    for (const group of ctx.models) {
        if (group.models.length === 0) continue;
        const dir = group.slug ? `${ctx.modelsDir}/${group.slug}` : ctx.modelsDir;
        const paths = group.models.map(m => `${dir}/${m.slug}`);
        if (group.area === undefined) {
            pages.push(...paths);
        } else {
            pages.push({ group: group.title, pages: paths });
        }
    }

    return pages;
}

/**
 * The navigation block.
 *
 * With a tab name (the default) the generated groups go in their own tab, appended after any
 * tabs the user configured. With `tab: false` they are appended to `navigation.groups` instead,
 * for a site with no tab bar. Every other `navigation` key the user set — `global`, `versions`,
 * `languages` — passes through untouched.
 */
function buildNavigation(ctx: DocsJsonContext, userNav: Record<string, unknown>): Record<string, unknown> {
    const generated = buildGroups(ctx);
    const navigation: Record<string, unknown> = { ...userNav };

    if (ctx.config.tab === false) {
        const userGroups = Array.isArray(userNav.groups) ? (userNav.groups as unknown[]) : [];
        navigation.groups = [...userGroups, ...generated];
        return navigation;
    }

    const userTabs = Array.isArray(userNav.tabs) ? (userNav.tabs as unknown[]) : [];
    navigation.tabs = [...userTabs, { tab: ctx.config.tab ?? DEFAULT_TAB, groups: generated } satisfies NavTab];
    return navigation;
}

/** The site name: explicit config first, then the OpenAPI title, then a generic fallback. */
export function resolveSiteName(config: MintlifyConfig): string {
    const configured = config.docs?.name;
    if (typeof configured === 'string' && configured.length > 0) return configured;
    return config.openapi?.info?.title ?? 'API';
}

/**
 * Build the `docs.json` document.
 *
 * User config wins over every generated default except `navigation`, which is merged key by key
 * so the generated API reference survives alongside hand-written entries.
 */
export function buildDocsJson(ctx: DocsJsonContext): Record<string, unknown> {
    const userDocs = ctx.config.docs ?? {};
    const userNav = isRecord(userDocs.navigation) ? userDocs.navigation : {};

    return {
        $schema: SCHEMA_URL,
        theme: DEFAULT_THEME,
        name: resolveSiteName(ctx.config),
        colors: { primary: DEFAULT_PRIMARY },
        ...userDocs,
        navigation: buildNavigation(ctx, userNav),
    };
}

/** Serialize `docs.json` with the repo's four-space JSON style and a trailing newline. */
export function renderDocsJson(ctx: DocsJsonContext): string {
    return `${JSON.stringify(buildDocsJson(ctx), null, 4)}\n`;
}
