import { collectPublicTypeNames, collectTypeRefs, resolveModifiers } from '@contractkit/core';
import type { ContractRootNode, HttpMethod, ModelNode, OpOperationNode, OpRootNode, OpRouteNode } from '@contractkit/core';

/**
 * Titles, slugs and area grouping shared by every documentation target. Nothing here knows what
 * a page looks like — a target decides the file format, this decides what things are called and
 * what order they appear in.
 */

/** One documented operation, paired with the route it hangs off. */
export interface EndpointEntry {
    route: OpRouteNode;
    op: OpOperationNode;
    /** Human-readable page title. */
    title: string;
    /** Kebab-case page slug, unique within its group. */
    slug: string;
}

/** A navigation group of endpoints, keyed by the source file's `area` meta. */
export interface EndpointGroup {
    /** The `area` meta value, or undefined for files that declare none. */
    area: string | undefined;
    /** Display name for the group. */
    title: string;
    /** Directory slug the group's pages live under. */
    slug: string;
    endpoints: EndpointEntry[];
}

/** One documented model. */
export interface ModelEntry {
    model: ModelNode;
    title: string;
    slug: string;
}

/** A navigation group of models, keyed by the source file's `area` meta. */
export interface ModelGroup {
    /** The `area` meta value, or undefined for files that declare none. */
    area: string | undefined;
    /** Display name for the group. */
    title: string;
    /** Directory slug the group's pages live under, empty for area-less models. */
    slug: string;
    models: ModelEntry[];
}

/**
 * Verb used when an operation has no name to derive a title from. Mirrors the mapping
 * plugin-markdown uses so the two generators title the same endpoint the same way.
 */
const METHOD_VERBS: Record<HttpMethod, string> = {
    get: 'List',
    post: 'Create',
    put: 'Update',
    patch: 'Update',
    delete: 'Delete',
};

/** Lowercase, hyphen-separated, ASCII-safe. Empty input yields `untitled`. */
export function slugify(value: string): string {
    const slug = value
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
    return slug.length > 0 ? slug : 'untitled';
}

/**
 * Sentence case: upper-case the first letter only.
 *
 * Titles are mostly whole descriptions, and Title-Casing those reads badly — a real contract
 * produced "Look Up A Refund By Its Originating Payment". Capitalising just the first letter keeps
 * "Look up a refund by its originating payment".
 */
export function titleCase(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Turn an identifier into a display label: `bankConnections` and `bank-connections` both become
 * "Bank Connections". Area names are written in whatever style the contract author prefers, so
 * splitting on the case boundary as well as on separators is what keeps a sidebar readable.
 */
export function humanize(value: string): string {
    return startCase(
        splitCamel(value)
            .replace(/[._-]+/g, ' ')
            .trim(),
    );
}

/**
 * Upper-case the first letter of every word.
 *
 * Group labels are short noun phrases where every word reads as part of a name, so they take
 * start case; page titles are whole sentences and take {@link titleCase} instead.
 */
function startCase(value: string): string {
    return value.replace(/\b[a-z]/g, c => c.toUpperCase());
}

/** `listActiveUsers` → `list active users`. */
function splitCamel(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * Turn a third-person description into an imperative heading: "Creates a payment" reads as
 * "Create a payment" once it is a title. Words ending in a double `s` ("Process") are left
 * alone. Mirrors plugin-markdown so the same endpoint gets the same heading in both outputs.
 */
function normalizeVerbTitle(title: string): string {
    const spaceIdx = title.indexOf(' ');
    if (spaceIdx === -1) return title;

    const firstWord = title.slice(0, spaceIdx);
    const rest = title.slice(spaceIdx);
    if (firstWord.length > 3 && firstWord.endsWith('s') && !firstWord.endsWith('ss')) {
        return firstWord.slice(0, -1) + rest;
    }
    return title;
}

/**
 * Page title for an operation, in priority order: explicit `name:`, then the description, then
 * the service method name, then the HTTP verb plus the path's literal segments.
 *
 * The description ranks above the service method because a method name alone is usually too
 * thin to title a page — `PaymentService.create` gives "Create", where the description gives
 * "Create a payment".
 */
export function deriveTitle(op: OpOperationNode, route: OpRouteNode): string {
    if (op.name) return titleCase(splitCamel(op.name.trim()));

    if (op.description) return normalizeVerbTitle(titleCase(op.description.trim()));

    if (op.service) {
        const methodPart = op.service.split('.').pop();
        if (methodPart) return titleCase(splitCamel(methodPart));
    }

    const segments = route.path.split('/').filter(s => s.length > 0 && !s.startsWith('{'));
    const pathWords = segments.join(' ').replace(/[._-]/g, ' ');
    const verb = METHOD_VERBS[op.method] ?? op.method.toUpperCase();
    return pathWords.length > 0 ? `${verb} ${pathWords}` : verb;
}

/**
 * Base page slug for an operation: `sdk:`, then `name:`, then the service method, then the HTTP
 * method plus the path's literal segments. Uniqueness within a group is applied separately by
 * {@link groupEndpoints}.
 */
export function derivePageSlug(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return slugify(op.sdk);
    if (op.name) return slugify(op.name);
    if (op.service) {
        const methodPart = op.service.split('.').pop();
        if (methodPart) return slugify(methodPart);
    }
    const segments = route.path.split('/').filter(s => s.length > 0 && !s.startsWith('{'));
    return slugify([op.method, ...segments].join('-'));
}

/** Append `-2`, `-3`, … until the slug is unused, then record it as taken. */
function uniqueSlug(base: string, taken: Set<string>): string {
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    const slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
}

/**
 * Group documentable operations by their source file's `area` meta.
 *
 * Files with no `area` come first as a single group, then each area in first-seen order —
 * the same ordering plugin-markdown produces, so the two outputs stay comparable. Operations
 * marked `internal` are dropped unless `includeInternal` is set.
 */
export function groupEndpoints(opRoots: OpRootNode[], includeInternal = false): EndpointGroup[] {
    const grouped = new Map<string, EndpointEntry[]>();
    const ungrouped: EndpointEntry[] = [];
    const slugsByGroup = new Map<string, Set<string>>();

    const takenFor = (key: string): Set<string> => {
        let taken = slugsByGroup.get(key);
        if (!taken) {
            taken = new Set<string>();
            slugsByGroup.set(key, taken);
        }
        return taken;
    };

    for (const opRoot of opRoots) {
        const area = opRoot.meta?.area;
        for (const route of opRoot.routes) {
            for (const op of route.operations) {
                if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
                const entry: EndpointEntry = {
                    route,
                    op,
                    title: deriveTitle(op, route),
                    slug: uniqueSlug(derivePageSlug(op, route), takenFor(area ?? '')),
                };
                if (area) {
                    const list = grouped.get(area) ?? [];
                    list.push(entry);
                    grouped.set(area, list);
                } else {
                    ungrouped.push(entry);
                }
            }
        }
    }

    const result: EndpointGroup[] = [];
    if (ungrouped.length > 0) {
        result.push({ area: undefined, title: 'Endpoints', slug: 'endpoints', endpoints: ungrouped });
    }
    for (const [area, endpoints] of grouped) {
        result.push({ area, title: humanize(area), slug: slugify(area), endpoints });
    }
    return result;
}

/**
 * Every model reachable from a documented operation, grouped by its source file's `area` meta
 * and in declaration order within each group.
 *
 * Reachability is computed from the OpenAPI document rather than re-walked here: the spec's
 * `components.schemas` already holds exactly the models the operations can reach, filtered by
 * the same `includeInternal` setting. Reading it keeps one definition of "public model" instead
 * of two that can drift.
 *
 * Area-less models come first as a single group, matching how {@link groupEndpoints} orders its
 * output. A project whose contracts declare no areas therefore gets exactly one group, which is
 * the flat list it had before grouping existed.
 *
 * `schemaNames` is the set of models to document. Passing `null` documents every model, which is
 * what a project with no operation files needs: there are no public operations to reach anything
 * from, but the contracts are still worth rendering.
 */
export function groupModels(contractRoots: ContractRootNode[], schemaNames: ReadonlySet<string> | null): ModelGroup[] {
    const grouped = new Map<string, ModelEntry[]>();
    const ungrouped: ModelEntry[] = [];
    const slugsByGroup = new Map<string, Set<string>>();

    for (const contractRoot of contractRoots) {
        const area = contractRoot.meta?.area;
        let taken = slugsByGroup.get(area ?? '');
        if (!taken) {
            taken = new Set<string>();
            slugsByGroup.set(area ?? '', taken);
        }
        for (const model of contractRoot.models) {
            if (schemaNames !== null && !schemaNames.has(model.name)) continue;
            const entry: ModelEntry = { model, title: model.name, slug: uniqueSlug(slugify(model.name), taken) };
            if (area) {
                const list = grouped.get(area) ?? [];
                list.push(entry);
                grouped.set(area, list);
            } else {
                ungrouped.push(entry);
            }
        }
    }

    const result: ModelGroup[] = [];
    if (ungrouped.length > 0) {
        result.push({ area: undefined, title: 'Models', slug: '', models: ungrouped });
    }
    for (const [area, models] of grouped) {
        result.push({ area, title: humanize(area), slug: slugify(area), models });
    }
    return result;
}

/**
 * The set of model names reachable from public operations, closed transitively.
 *
 * Returns `null` when there are no operation files at all, meaning "document everything": there
 * are no public operations to reach anything from, but the contracts are still worth rendering.
 * Feed the result straight to {@link groupModels}, which understands the same `null`.
 */
export function computePubliclyReachableModels(opRoots: OpRootNode[], contractRoots: ContractRootNode[]): Set<string> | null {
    if (opRoots.length === 0) return null;

    const reachable = new Set<string>();
    for (const opRoot of opRoots) {
        for (const name of collectPublicTypeNames(opRoot)) reachable.add(name);
    }

    const modelDeps = new Map<string, Set<string>>();
    for (const contractRoot of contractRoots) {
        for (const model of contractRoot.models) {
            const deps = new Set<string>();
            if (model.bases) for (const b of model.bases) deps.add(b);
            if (model.type) collectTypeRefs(model.type, deps);
            for (const field of model.fields) collectTypeRefs(field.type, deps);
            modelDeps.set(model.name, deps);
        }
    }

    const frontier = [...reachable];
    while (frontier.length > 0) {
        const name = frontier.pop()!;
        for (const dep of modelDeps.get(name) ?? []) {
            if (!reachable.has(dep)) {
                reachable.add(dep);
                frontier.push(dep);
            }
        }
    }

    return reachable;
}
