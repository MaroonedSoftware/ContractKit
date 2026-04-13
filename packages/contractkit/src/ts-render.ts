import type { ContractTypeNode, OpRootNode, ParamSource, FieldNode } from './ast.js';
import { resolveModifiers } from './ast.js';

export const JSON_VALUE_TYPE_DECL = 'export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };';

export function quoteKey(name: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name) ? name : `'${name}'`;
}

// ─── TypeScript type rendering ────────────────────────────────────────────

export function renderTsType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name);
        case 'array': {
            const inner = renderTsType(type.item);
            const needsParens = type.item.kind === 'union' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(renderTsType).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key)}, ${renderTsType(type.value)}>`;
        case 'enum':
            return type.values.map(v => `'${v}'`).join(' | ');
        case 'literal':
            return typeof type.value === 'string' ? `'${type.value}'` : String(type.value);
        case 'union':
            return type.members.map(renderTsType).join(' | ');
        case 'intersection':
            return type.members.map(renderTsType).join(' & ');
        case 'ref':
            return type.name;
        case 'lazy':
            return renderTsType(type.inner);
        case 'inlineObject':
            return renderTsInlineObject(type.fields);
        default:
            return 'unknown';
    }
}

function renderTsScalar(name: string): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'uuid':
            return 'string';
        case 'number':
        case 'int':
            return 'number';
        case 'bigint':
            return 'bigint';
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'datetime':
            return 'string';
        case 'null':
            return 'null';
        case 'unknown':
            return 'unknown';
        case 'object':
            return 'Record<string, unknown>';
        case 'binary':
            return 'Blob';
        case 'json':
            return 'JsonValue';
        default:
            return 'unknown';
    }
}

function renderTsInlineObject(fields: FieldNode[]): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${quoteKey(f.name)}${opt}: ${renderTsType(f.type)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

/**
 * Like renderTsType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers. Used for request-side types
 * (body, params, query, headers).
 */
export function renderInputTsType(type: ContractTypeNode, modelsWithInput?: Set<string>): string {
    if (!modelsWithInput || modelsWithInput.size === 0) return renderTsType(type);
    switch (type.kind) {
        case 'ref':
            return modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            const inner = renderInputTsType(type.item, modelsWithInput);
            const needsParens = type.item.kind === 'union' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' & ');
        case 'union':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${quoteKey(f.name)}${f.optional ? '?' : ''}: ${renderInputTsType(f.type, modelsWithInput)}`).join('; ')} }`;
        case 'lazy':
            return renderInputTsType(type.inner, modelsWithInput);
        default:
            return renderTsType(type);
    }
}

// ─── Type collection ──────────────────────────────────────────────────────

/**
 * Returns the set of type names directly referenced by public (non-internal)
 * operations in the root. Does not include transitive dependencies — callers
 * should expand these through the DTO model graph if needed.
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
