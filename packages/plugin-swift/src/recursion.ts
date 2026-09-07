import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode } from '@contractkit/core';
import { resolveEffectiveFields } from '@contractkit/core';
import type { HoistResult } from './hoist.js';

/**
 * A Swift struct cannot contain itself, not even behind an `Optional`: `struct Node { var parent:
 * Node? }` is rejected as infinitely sized. The `.ck` language allows exactly that, with or without
 * a `lazy(...)` marker, so the generator has to find every stored property that closes a cycle of
 * value types and route it through a heap box.
 *
 * Only *direct* containment counts. An `array`, a `record`, and every union enum (which is emitted
 * `indirect`) already put their contents on the heap, so a cycle that passes through one of them
 * needs no help. The pass therefore builds a graph of struct-like declarations joined by the fields
 * that hold another one inline, and boxes each field whose target sits in the same strongly
 * connected component as its owner.
 */

export interface RecursionOptions {
    modelIndex: ReadonlyMap<string, ModelNode>;
    hoisted: HoistResult;
}

/**
 * The stored properties that have to be boxed, as `"<Declaration>.<field>"` keys. A tuple item is
 * `"<Declaration>._<index>"`. Sorted, so the set is stable across runs and safe to fingerprint.
 */
export function collectBoxedFields(roots: readonly ContractRootNode[], opts: RecursionOptions): ReadonlySet<string> {
    const nodes = collectStructNodes(roots, opts);
    const edges = new Map<string, { field: string; target: string }[]>();

    for (const node of nodes.values()) {
        const list: { field: string; target: string }[] = [];
        for (const { name, type } of node.fields) {
            for (const target of directTargets(type, opts, new Set())) {
                if (nodes.has(target)) list.push({ field: name, target });
            }
        }
        edges.set(node.name, list);
    }

    const component = stronglyConnectedComponents([...nodes.keys()], name => (edges.get(name) ?? []).map(e => e.target));

    const boxed: string[] = [];
    for (const [owner, list] of edges) {
        for (const { field, target } of list) {
            if (component.get(owner) === component.get(target)) boxed.push(`${owner}.${field}`);
        }
    }
    return new Set([...new Set(boxed)].sort());
}

interface StructNode {
    name: string;
    fields: { name: string; type: ContractTypeNode }[];
}

/** Every declaration the generator renders as a struct, with the fields it stores inline. */
function collectStructNodes(roots: readonly ContractRootNode[], opts: RecursionOptions): Map<string, StructNode> {
    const nodes = new Map<string, StructNode>();
    const add = (name: string, fields: readonly FieldNode[]): void => {
        nodes.set(name, { name, fields: fields.map(f => ({ name: f.name, type: f.type })) });
    };

    for (const root of roots) {
        for (const model of root.models) {
            if (!model.type) {
                const fields = model.bases && model.bases.length > 0 ? resolveEffectiveFields(model.name, opts.modelIndex).fields : model.fields;
                add(model.name, fields);
                continue;
            }
            const inner = unwrapLazy(model.type);
            // An intersection or inline object at model level is rendered as a struct under the
            // model's own name; every other alias is a typealias and stores nothing itself.
            if ((inner.kind === 'intersection' || inner.kind === 'inlineObject') && !opts.hoisted.byNode.has(inner)) {
                add(model.name, resolveEffectiveFields(inner, opts.modelIndex).fields);
            }
        }
    }

    for (const decls of opts.hoisted.byFile.values()) {
        for (const decl of decls) {
            if (decl.kind === 'struct') add(decl.name, decl.fields ?? []);
            else if (decl.kind === 'tuple') {
                nodes.set(decl.name, { name: decl.name, fields: (decl.items ?? []).map((type, i) => ({ name: `_${i}`, type })) });
            }
        }
    }

    return nodes;
}

/**
 * The struct declarations `type` stores inline, following alias chains and `lazy` markers but
 * stopping at anything heap-allocated.
 */
function directTargets(type: ContractTypeNode, opts: RecursionOptions, visiting: Set<string>): string[] {
    const decl = opts.hoisted.byNode.get(type);
    if (decl) {
        // A hoisted enum or union is a Swift enum, and the union enums are `indirect`; only a
        // hoisted struct or tuple is a value type stored in place.
        return decl.kind === 'struct' || decl.kind === 'tuple' ? [decl.name] : [];
    }

    switch (type.kind) {
        case 'lazy':
            return directTargets(type.inner, opts, visiting);
        case 'union': {
            // `union(T, null)` renders as `T?`, which stores T inline; a wider union is an enum.
            const nonNull = type.members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));
            return nonNull.length === 1 ? directTargets(nonNull[0]!, opts, visiting) : [];
        }
        case 'ref': {
            const model = opts.modelIndex.get(type.name);
            if (!model) return [];
            if (!model.type) return [model.name];
            const inner = unwrapLazy(model.type);
            if (inner.kind === 'intersection' || inner.kind === 'inlineObject') return opts.hoisted.byNode.has(inner) ? [] : [model.name];
            // Any other alias is transparent: `contract Ref: lazy(Node)` stores whatever Node is.
            if (visiting.has(model.name)) return [];
            visiting.add(model.name);
            return directTargets(model.type, opts, visiting);
        }
        default:
            // Scalars and literals store nothing; arrays, records, enums, unions and intersections
            // are either heap-allocated or have been hoisted and handled above.
            return [];
    }
}

function unwrapLazy(type: ContractTypeNode): ContractTypeNode {
    return type.kind === 'lazy' ? unwrapLazy(type.inner) : type;
}

/** Tarjan's algorithm. Returns each node's component id; nodes in one cycle share an id. */
function stronglyConnectedComponents(nodes: readonly string[], successors: (node: string) => string[]): Map<string, number> {
    const index = new Map<string, number>();
    const lowLink = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const component = new Map<string, number>();
    let nextIndex = 0;
    let nextComponent = 0;

    const visit = (node: string): void => {
        index.set(node, nextIndex);
        lowLink.set(node, nextIndex);
        nextIndex++;
        stack.push(node);
        onStack.add(node);

        for (const next of successors(node)) {
            if (!index.has(next)) {
                visit(next);
                lowLink.set(node, Math.min(lowLink.get(node)!, lowLink.get(next)!));
            } else if (onStack.has(next)) {
                lowLink.set(node, Math.min(lowLink.get(node)!, index.get(next)!));
            }
        }

        if (lowLink.get(node) === index.get(node)) {
            let member: string;
            do {
                member = stack.pop()!;
                onStack.delete(member);
                component.set(member, nextComponent);
            } while (member !== node);
            nextComponent++;
        }
    };

    for (const node of nodes) if (!index.has(node)) visit(node);
    return component;
}
