import type { CkRootNode, ModelNode, OpRouteNode, ContractTypeNode } from '@maroonedsoftware/contractkit';

/**
 * Split models and routes into per-tag CkRootNode instances.
 *
 * Algorithm:
 * 1. Routes are assigned to the file of their first tag (untagged → 'default')
 * 2. Models referenced by exactly one tag go into that tag's file
 * 3. Models referenced by 2+ tags go into 'shared'
 * 4. Orphan models (not referenced by any route) go into 'shared'
 */
export function splitByTag(models: ModelNode[], routes: OpRouteNode[], routeTags: Map<OpRouteNode, string>): Map<string, CkRootNode> {
    // Step 1: Group routes by tag
    const routesByTag = new Map<string, OpRouteNode[]>();
    for (const route of routes) {
        const tag = routeTags.get(route) ?? 'default';
        const group = routesByTag.get(tag) ?? [];
        group.push(route);
        routesByTag.set(tag, group);
    }

    // Step 2: For each tag, collect which model names are referenced
    const modelsByTag = new Map<string, Set<string>>();
    for (const [tag, tagRoutes] of routesByTag) {
        const refs = new Set<string>();
        for (const route of tagRoutes) {
            collectRouteRefs(route, refs);
        }
        modelsByTag.set(tag, refs);
    }

    // Step 3: Determine which tag each model belongs to
    const modelNameToModel = new Map(models.map(m => [m.name, m]));
    const modelAssignment = new Map<string, string>(); // modelName → tag or 'shared'

    for (const model of models) {
        const tags: string[] = [];
        for (const [tag, refs] of modelsByTag) {
            if (refs.has(model.name)) {
                tags.push(tag);
            }
        }

        if (tags.length === 0) {
            // Orphan model → shared
            modelAssignment.set(model.name, 'shared');
        } else if (tags.length === 1) {
            // Single tag reference → that tag's file
            modelAssignment.set(model.name, tags[0]!);
        } else {
            // Multi-tag reference → shared
            modelAssignment.set(model.name, 'shared');
        }
    }

    // Also check transitive: models referenced by shared models should also be shared
    // (simple one-pass — could iterate to fixed point for deep chains)
    for (const model of models) {
        if (modelAssignment.get(model.name) === 'shared') {
            const refs = new Set<string>();
            collectModelRefs(model, refs);
            for (const ref of refs) {
                if (modelNameToModel.has(ref)) {
                    const currentTag = modelAssignment.get(ref);
                    // Only promote to shared if it was assigned to a specific tag
                    // (don't override if already shared)
                    if (currentTag && currentTag !== 'shared') {
                        // Check if another tag also references this model
                        const otherTags = [...modelsByTag.entries()].filter(([t, r]) => t !== currentTag && r.has(ref)).map(([t]) => t);
                        if (otherTags.length > 0) {
                            modelAssignment.set(ref, 'shared');
                        }
                    }
                }
            }
        }
    }

    // Step 4: Build CkRootNode per tag
    const result = new Map<string, CkRootNode>();
    const allTags = new Set([...routesByTag.keys(), ...new Set(modelAssignment.values())]);

    for (const tag of allTags) {
        const tagModels = models.filter(m => modelAssignment.get(m.name) === tag);
        const tagRoutes = routesByTag.get(tag) ?? [];

        if (tagModels.length === 0 && tagRoutes.length === 0) continue;

        const filename = sanitizeFilename(tag);
        result.set(`${filename}.ck`, {
            kind: 'ckRoot',
            meta: tag !== 'shared' ? { area: tag } : {},
            services: {},
            models: tagModels,
            routes: tagRoutes,
            file: `${filename}.ck`,
        });
    }

    return result;
}

/**
 * Create a single CkRootNode with all models and routes.
 */
export function mergeIntoSingle(models: ModelNode[], routes: OpRouteNode[], filename: string = 'api'): CkRootNode {
    return {
        kind: 'ckRoot',
        meta: {},
        services: {},
        models,
        routes,
        file: `${filename}.ck`,
    };
}

// ─── Reference Collection ─────────────────────────────────────────────────

function collectRouteRefs(route: OpRouteNode, refs: Set<string>): void {
    if (route.params) {
        collectParamSourceRefs(route.params, refs);
    }
    for (const op of route.operations) {
        if (op.query) collectParamSourceRefs(op.query, refs);
        if (op.headers) collectParamSourceRefs(op.headers, refs);
        if (op.request) {
            for (const body of op.request.bodies) collectTypeRefs(body.bodyType, refs);
        }
        for (const resp of op.responses) {
            if (resp.bodyType) collectTypeRefs(resp.bodyType, refs);
        }
    }
}

function collectParamSourceRefs(source: unknown, refs: Set<string>): void {
    if (typeof source === 'string') {
        refs.add(source);
        return;
    }
    if (Array.isArray(source)) {
        for (const param of source) {
            if (param && typeof param === 'object' && 'type' in param) {
                collectTypeRefs(param.type as ContractTypeNode, refs);
            }
        }
        return;
    }
    if (source && typeof source === 'object' && 'kind' in source) {
        collectTypeRefs(source as ContractTypeNode, refs);
    }
}

function collectTypeRefs(type: ContractTypeNode, refs: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            refs.add(type.name);
            break;
        case 'array':
            collectTypeRefs(type.item, refs);
            break;
        case 'tuple':
            for (const item of type.items) collectTypeRefs(item, refs);
            break;
        case 'record':
            collectTypeRefs(type.key, refs);
            collectTypeRefs(type.value, refs);
            break;
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            for (const member of type.members) collectTypeRefs(member, refs);
            break;
        case 'inlineObject':
            for (const field of type.fields) collectTypeRefs(field.type, refs);
            break;
        case 'lazy':
            collectTypeRefs(type.inner, refs);
            break;
    }
}

function collectModelRefs(model: ModelNode, refs: Set<string>): void {
    if (model.base) refs.add(model.base);
    if (model.type) collectTypeRefs(model.type, refs);
    for (const field of model.fields) {
        collectTypeRefs(field.type, refs);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function sanitizeFilename(tag: string): string {
    return (
        tag
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'default'
    );
}
