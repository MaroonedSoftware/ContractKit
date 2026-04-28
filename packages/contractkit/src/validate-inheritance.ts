/**
 * Validates multi-base inheritance: detects cycles, enforces that conflicting fields across
 * bases are explicitly redeclared with the `override` modifier, and rejects spurious `override`
 * modifiers on fields not present in any base.
 *
 * Resolution rules:
 * - Each base contributes its fully-resolved field set (recursive). Diamond inheritance is
 *   deduplicated — a model reachable via multiple paths only contributes its fields once.
 * - Two fields with the same name conflict iff their `FieldNode` shapes differ on any of:
 *   type, optional, nullable, visibility, default, deprecated. `description` and `loc` are ignored.
 * - When two or more bases contribute a same-named field, the model must redeclare that field
 *   in its own inline block with `override`.
 * - A field with `override` must shadow at least one base-contributed field.
 *
 * Runs after `validate-refs` so we know all referenced bases resolve. Cycles short-circuit
 * the recursion so a downstream conflict check on a cyclic chain emits one cycle error per cycle,
 * not one per node.
 */
import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';

export function validateInheritance(contractRoots: ContractRootNode[], diag: DiagnosticCollector): void {
    const modelMap = new Map<string, ModelNode>();
    for (const root of contractRoots) {
        for (const model of root.models) modelMap.set(model.name, model);
    }

    const cycleNodes = detectCycles(modelMap, diag);

    for (const root of contractRoots) {
        for (const model of root.models) {
            if (!model.bases || model.bases.length === 0) continue;
            if (cycleNodes.has(model.name)) continue;
            checkModel(model, modelMap, cycleNodes, diag);
        }
    }
}

function detectCycles(modelMap: Map<string, ModelNode>, diag: DiagnosticCollector): Set<string> {
    const onStack = new Set<string>();
    const visited = new Set<string>();
    const inCycle = new Set<string>();

    function visit(name: string, path: string[]): void {
        if (onStack.has(name)) {
            const start = path.indexOf(name);
            const cycle = path.slice(start).concat(name).join(' → ');
            for (const n of path.slice(start)) inCycle.add(n);
            const model = modelMap.get(name);
            if (model) diag.error(model.loc.file, model.loc.line, `Inheritance cycle: ${cycle}`);
            return;
        }
        if (visited.has(name)) return;
        const model = modelMap.get(name);
        if (!model || !model.bases) {
            visited.add(name);
            return;
        }
        onStack.add(name);
        path.push(name);
        for (const b of model.bases) visit(b, path);
        path.pop();
        onStack.delete(name);
        visited.add(name);
    }

    for (const name of modelMap.keys()) visit(name, []);
    return inCycle;
}

/** Resolve a base model to its **effective** field set: the merge of all its inherited
 * fields with its own (own fields shadow inherited by name). Memoized per model. */
function resolveEffectiveFields(
    baseName: string,
    modelMap: Map<string, ModelNode>,
    cycleNodes: Set<string>,
    cache: Map<string, Map<string, FieldNode>>,
): Map<string, FieldNode> {
    const cached = cache.get(baseName);
    if (cached) return cached;
    if (cycleNodes.has(baseName)) {
        const empty = new Map<string, FieldNode>();
        cache.set(baseName, empty);
        return empty;
    }
    const base = modelMap.get(baseName);
    if (!base) {
        const empty = new Map<string, FieldNode>();
        cache.set(baseName, empty);
        return empty;
    }
    // Set early to break any unexpected recursion.
    const effective = new Map<string, FieldNode>();
    cache.set(baseName, effective);
    if (base.bases) {
        for (const grandparent of base.bases) {
            const g = resolveEffectiveFields(grandparent, modelMap, cycleNodes, cache);
            for (const [name, field] of g) effective.set(name, field);
        }
    }
    for (const own of base.fields) {
        effective.set(own.name, own);
    }
    return effective;
}

function checkModel(model: ModelNode, modelMap: Map<string, ModelNode>, cycleNodes: Set<string>, diag: DiagnosticCollector): void {
    const cache = new Map<string, Map<string, FieldNode>>();

    // For each direct base, resolve its effective field set. Cross-base conflicts are detected
    // by comparing same-named contributions across bases (each base's own overrides already
    // applied within its set).
    const baseFieldsByName = new Map<string, { source: string; field: FieldNode }[]>();
    for (const base of model.bases!) {
        const effective = resolveEffectiveFields(base, modelMap, cycleNodes, cache);
        for (const [name, field] of effective) {
            const list = baseFieldsByName.get(name) ?? [];
            list.push({ source: base, field });
            baseFieldsByName.set(name, list);
        }
    }

    const localFieldsByName = new Map<string, FieldNode>();
    for (const f of model.fields) localFieldsByName.set(f.name, f);

    // Rule: every cross-base conflict must be redeclared with override.
    for (const [name, list] of baseFieldsByName) {
        if (list.length < 2) continue;
        const allIdentical = list.every(item => fieldsAreIdentical(item.field, list[0]!.field));
        if (allIdentical) continue;
        const local = localFieldsByName.get(name);
        if (!local) {
            const sources = list.map(l => `'${l.source}'`).join(' and ');
            diag.error(
                model.loc.file,
                model.loc.line,
                `Field '${name}' is declared by ${sources} with different shapes — redeclare in '${model.name}' with 'override'`,
            );
            continue;
        }
        if (!local.override) {
            const sources = list.map(l => `'${l.source}'`).join(' and ');
            diag.error(
                local.loc.file,
                local.loc.line,
                `Field '${name}' conflicts across bases ${sources} — mark as 'override'`,
            );
        }
    }

    // Rule: `override` must shadow at least one base-contributed field.
    for (const f of model.fields) {
        if (!f.override) continue;
        if (!baseFieldsByName.has(f.name)) {
            diag.error(f.loc.file, f.loc.line, `Field '${f.name}' has 'override' but is not declared in any base of '${model.name}'`);
        }
    }
}

/** Structural deep-equality on a FieldNode for inheritance-conflict purposes.
 * Compares: type (deep), optional, nullable, visibility, default, deprecated.
 * Ignores: description, loc, override (the marker itself isn't part of "shape"). */
export function fieldsAreIdentical(a: FieldNode, b: FieldNode): boolean {
    if (a.optional !== b.optional) return false;
    if (a.nullable !== b.nullable) return false;
    if (a.visibility !== b.visibility) return false;
    if ((a.deprecated ?? false) !== (b.deprecated ?? false)) return false;
    if (a.default !== b.default) return false;
    return typesAreIdentical(a.type, b.type);
}

function typesAreIdentical(a: ContractTypeNode, b: ContractTypeNode): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'scalar': {
            const bb = b as typeof a;
            return a.name === bb.name && a.min === bb.min && a.max === bb.max && a.len === bb.len && a.regex === bb.regex && a.format === bb.format;
        }
        case 'literal': {
            const bb = b as typeof a;
            return a.value === bb.value;
        }
        case 'enum': {
            const bb = b as typeof a;
            return a.values.length === bb.values.length && a.values.every((v, i) => v === bb.values[i]);
        }
        case 'ref': {
            const bb = b as typeof a;
            return a.name === bb.name;
        }
        case 'array': {
            const bb = b as typeof a;
            if (a.min !== bb.min || a.max !== bb.max) return false;
            return typesAreIdentical(a.item, bb.item);
        }
        case 'tuple': {
            const bb = b as typeof a;
            return a.items.length === bb.items.length && a.items.every((it, i) => typesAreIdentical(it, bb.items[i]!));
        }
        case 'record': {
            const bb = b as typeof a;
            return typesAreIdentical(a.key, bb.key) && typesAreIdentical(a.value, bb.value);
        }
        case 'union':
        case 'intersection': {
            const bb = b as typeof a;
            return a.members.length === bb.members.length && a.members.every((m, i) => typesAreIdentical(m, bb.members[i]!));
        }
        case 'discriminatedUnion': {
            const bb = b as typeof a;
            if (a.discriminator !== bb.discriminator) return false;
            return a.members.length === bb.members.length && a.members.every((m, i) => typesAreIdentical(m, bb.members[i]!));
        }
        case 'lazy': {
            const bb = b as typeof a;
            return typesAreIdentical(a.inner, bb.inner);
        }
        case 'inlineObject': {
            const bb = b as typeof a;
            if (a.fields.length !== bb.fields.length) return false;
            for (let i = 0; i < a.fields.length; i++) {
                const af = a.fields[i]!;
                const bf = bb.fields[i]!;
                if (af.name !== bf.name) return false;
                if (!fieldsAreIdentical(af, bf)) return false;
            }
            return true;
        }
    }
}
