import type { ContractTypeNode, ContractRootNode, ModelNode, OpRootNode, ParamSource } from './ast.js';
import { resolveModifiers } from './ast.js';

// ─── Type collection ──────────────────────────────────────────────────────

/**
 * Returns the set of type names directly referenced by public (non-internal)
 * operations in the root. Does not include transitive dependencies — callers
 * should expand these through the contract model graph if needed.
 */
export function collectPublicTypeNames(root: OpRootNode, modelsWithInput?: Set<string>): Set<string> {
    return new Set(collectTypes(root, modelsWithInput));
}

function collectTypes(root: OpRootNode, modelsWithInput?: Set<string>): string[] {
    const types = new Set<string>();
    for (const route of root.routes) {
        const publicOps = route.operations.filter(op => !resolveModifiers(route, op).includes('internal'));
        if (publicOps.length === 0) continue;
        // Only collect path-param types if there are public ops on this route
        collectParamSourceRefs(route.params, types);
        collectParamSourceInputRefs(route.params, types, modelsWithInput);
        for (const op of publicOps) {
            if (op.request?.bodyType) {
                collectTypeNodeRefs(op.request.bodyType, types);
                collectInputTypeNodeRefs(op.request.bodyType, types, modelsWithInput);
            }
            for (const resp of op.responses) {
                if (resp.bodyType) collectTypeNodeRefs(resp.bodyType, types);
            }
            collectParamSourceRefs(op.query, types);
            collectParamSourceInputRefs(op.query, types, modelsWithInput);
            collectParamSourceRefs(op.headers, types);
            collectParamSourceInputRefs(op.headers, types, modelsWithInput);
        }
    }
    return [...types].sort();
}

/** Collect Input variant refs for request-side ParamSource types. */
function collectParamSourceInputRefs(source: ParamSource | undefined, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!source || !modelsWithInput) return;
    if (source.kind === 'ref') {
        if (modelsWithInput.has(source.name)) out.add(`${source.name}Input`);
    } else if (source.kind === 'params') {
        for (const param of source.nodes) {
            collectInputTypeNodeRefs(param.type, out, modelsWithInput);
        }
    } else {
        collectInputTypeNodeRefs(source.node, out, modelsWithInput);
    }
}

/** Collect Input variant refs for request-side ContractTypeNode types. */
function collectInputTypeNodeRefs(type: ContractTypeNode, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!modelsWithInput) return;
    switch (type.kind) {
        case 'ref':
            if (modelsWithInput.has(type.name)) out.add(`${type.name}Input`);
            break;
        case 'array':
            collectInputTypeNodeRefs(type.item, out, modelsWithInput);
            break;
        case 'intersection':
        case 'union':
        case 'discriminatedUnion':
            type.members.forEach(m => collectInputTypeNodeRefs(m, out, modelsWithInput));
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectInputTypeNodeRefs(f.type, out, modelsWithInput));
            break;
        case 'lazy':
            collectInputTypeNodeRefs(type.inner, out, modelsWithInput);
            break;
    }
}

function collectParamSourceRefs(source: ParamSource | undefined, out: Set<string>): void {
    if (!source) return;
    if (source.kind === 'ref') {
        if (/^[A-Z]/.test(source.name)) out.add(source.name);
    } else if (source.kind === 'params') {
        for (const param of source.nodes) {
            collectTypeNodeRefs(param.type, out);
        }
    } else {
        collectTypeNodeRefs(source.node, out);
    }
}

function collectTypeNodeRefs(type: ContractTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            if (/^[A-Z]/.test(type.name)) out.add(type.name);
            break;
        case 'array':
            collectTypeNodeRefs(type.item, out);
            break;
        case 'tuple':
            type.items.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'record':
            collectTypeNodeRefs(type.key, out);
            collectTypeNodeRefs(type.value, out);
            break;
        case 'union':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'intersection':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'lazy':
            collectTypeNodeRefs(type.inner, out);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectTypeNodeRefs(f.type, out));
            break;
    }
}

export function collectTypeRefs(type: ContractTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            out.add(type.name);
            break;
        case 'array':
            collectTypeRefs(type.item, out);
            break;
        case 'tuple':
            type.items.forEach(t => collectTypeRefs(t, out));
            break;
        case 'record':
            collectTypeRefs(type.key, out);
            collectTypeRefs(type.value, out);
            break;
        case 'union':
            type.members.forEach(t => collectTypeRefs(t, out));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => collectTypeRefs(t, out));
            break;
        case 'intersection':
            type.members.forEach(t => collectTypeRefs(t, out));
            break;
        case 'lazy':
            collectTypeRefs(type.inner, out);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectTypeRefs(f.type, out));
            break;
    }
}

// ─── Contract model utilities ─────────────────────────────────────────────

/**
 * Compute which models need Input variants, including transitive dependencies.
 * A model needs an Input variant if it has visibility-modified fields, OR if
 * any of its field types (recursively) reference a model that has an Input variant.
 */
export function computeModelsWithInput(models: ModelNode[], externalModelsWithInput: Set<string> = new Set()): Set<string> {
    const result = new Set<string>();

    // Initial pass: direct visibility modifiers
    for (const model of models) {
        if (model.fields.some(f => f.visibility !== 'normal')) {
            result.add(model.name);
        }
    }

    // Transitive closure
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of models) {
            if (result.has(model.name)) continue;
            const refs = new Set<string>();
            for (const field of model.fields) {
                collectTypeRefs(field.type, refs);
            }
            if (model.base) refs.add(model.base);
            if (model.type) collectTypeRefs(model.type, refs);
            for (const ref of refs) {
                if (result.has(ref) || externalModelsWithInput.has(ref)) {
                    result.add(model.name);
                    changed = true;
                    break;
                }
            }
        }
    }

    return result;
}

export function collectExternalRefs(root: ContractRootNode): string[] {
    const localNames = new Set(root.models.map(m => m.name));
    const refs = new Set<string>();

    for (const model of root.models) {
        if (model.base && !localNames.has(model.base)) refs.add(model.base);
        if (model.type) collectTypeRefs(model.type, refs);
        for (const field of model.fields) {
            collectTypeRefs(field.type, refs);
        }
    }

    for (const name of localNames) refs.delete(name);
    return [...refs].sort();
}

/** Collect external Input variant refs needed for Input schema fields. */
export function collectExternalInputRefs(root: ContractRootNode, modelsWithInput: Set<string>): string[] {
    const localNames = new Set(root.models.map(m => m.name));
    const refs = new Set<string>();

    for (const model of root.models) {
        if (!modelsWithInput.has(model.name)) continue;
        if (model.type) {
            collectInputTypeRefsForExport(model.type, refs, modelsWithInput);
            continue;
        }
        if (model.base && modelsWithInput.has(model.base) && !localNames.has(model.base)) {
            refs.add(`${model.base}Input`);
        }
        const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
        for (const field of writeFields) {
            collectInputTypeRefsForExport(field.type, refs, modelsWithInput);
        }
    }

    for (const name of localNames) {
        refs.delete(`${name}Input`);
    }

    return [...refs].sort();
}

function collectInputTypeRefsForExport(type: ContractTypeNode, out: Set<string>, modelsWithInput: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            if (modelsWithInput.has(type.name)) out.add(`${type.name}Input`);
            break;
        case 'array':
            collectInputTypeRefsForExport(type.item, out, modelsWithInput);
            break;
        case 'tuple':
            type.items.forEach(i => collectInputTypeRefsForExport(i, out, modelsWithInput));
            break;
        case 'record':
            collectInputTypeRefsForExport(type.key, out, modelsWithInput);
            collectInputTypeRefsForExport(type.value, out, modelsWithInput);
            break;
        case 'union':
            type.members.forEach(m => collectInputTypeRefsForExport(m, out, modelsWithInput));
            break;
        case 'discriminatedUnion':
            type.members.forEach(m => collectInputTypeRefsForExport(m, out, modelsWithInput));
            break;
        case 'intersection':
            type.members.forEach(m => collectInputTypeRefsForExport(m, out, modelsWithInput));
            break;
        case 'lazy':
            collectInputTypeRefsForExport(type.inner, out, modelsWithInput);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectInputTypeRefsForExport(f.type, out, modelsWithInput));
            break;
    }
}

/**
 * Topologically sort models so dependencies are emitted before dependents.
 * Falls back to source order for cycles.
 */
export function topoSortModels(models: ModelNode[]): ModelNode[] {
    const localNames = new Set(models.map(m => m.name));
    const modelMap = new Map(models.map(m => [m.name, m]));

    const deps = new Map<string, Set<string>>();
    for (const model of models) {
        const refs = new Set<string>();
        if (model.base && localNames.has(model.base)) refs.add(model.base);
        if (model.type) collectTypeRefs(model.type, refs);
        for (const field of model.fields) {
            collectTypeRefs(field.type, refs);
        }
        const localDeps = new Set<string>();
        for (const r of refs) {
            if (localNames.has(r) && r !== model.name) localDeps.add(r);
        }
        deps.set(model.name, localDeps);
    }

    const remaining = new Map<string, Set<string>>();
    for (const [name, d] of deps) {
        remaining.set(name, new Set(d));
    }

    const queue: string[] = [];
    for (const name of localNames) {
        if (remaining.get(name)!.size === 0) queue.push(name);
    }

    const sorted: ModelNode[] = [];
    while (queue.length > 0) {
        const name = queue.shift()!;
        sorted.push(modelMap.get(name)!);
        for (const [other, rem] of remaining) {
            if (rem.delete(name) && rem.size === 0) {
                queue.push(other);
            }
        }
    }

    for (const model of models) {
        if (!sorted.includes(model)) sorted.push(model);
    }

    return sorted;
}

/** Convert PascalCase to dot-separated lowercase: CounterpartyAccount → counterparty.account */
export function pascalToDotCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}
