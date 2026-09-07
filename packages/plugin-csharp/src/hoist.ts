import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode } from '@contractkit/core';
import { collectTypeRefs, resolveEffectiveFields } from '@contractkit/core';
import { sanitizeCSharpTypeName, toCSharpTypeName } from './naming.js';

/**
 * C# needs a name for every shape a caller can hold. The `.ck` language does not: a union, an enum,
 * or an object literal can appear anonymously inside a field. This pass walks every model in the
 * project and assigns each such node a stable C# declaration, so the type renderer can emit a name
 * and the file emitter can emit the declaration behind it.
 *
 * It runs once over all contract roots rather than per file, because a discriminated union declared
 * in one file makes its member records, which may live in any other file, implement its interface.
 */

export type HoistKind = 'enum' | 'record' | 'plainUnion' | 'discriminatedUnion' | 'tuple';

export interface HoistedMember {
    /** The C# type of the member: a model name, or a hoisted declaration's name. */
    typeName: string;
    /** Nested record name inside a plain union's abstract record (`OfPayment`). */
    wrapperName?: string;
    /** Discriminator value for a discriminated union member. */
    tag?: string;
    type: ContractTypeNode;
}

export interface HoistedDecl {
    kind: HoistKind;
    name: string;
    /** The `.ck` file whose models file carries this declaration. */
    ownerFile: string;
    /** Whether a distinct `<Name>Input` twin has to be emitted alongside it. */
    needsInput: boolean;
    /** Rendered references become `Name?` — the union had a `null` member. */
    nullable?: boolean;
    members?: HoistedMember[];
    discriminator?: string;
    fields?: FieldNode[];
    values?: string[];
    items?: ContractTypeNode[];
    description?: string;
}

export interface HoistResult {
    /** The declaration standing in for an anonymous node, keyed by AST node identity. */
    byNode: Map<ContractTypeNode, HoistedDecl>;
    byName: Map<string, HoistedDecl>;
    /** Declarations each `.ck` file's models file has to emit, in collection order. */
    byFile: Map<string, HoistedDecl[]>;
    /** Model record name → the union interfaces it must declare it implements. */
    memberships: Map<string, string[]>;
}

export interface HoistOptions {
    modelIndex: ReadonlyMap<string, ModelNode>;
    modelsWithInput: ReadonlySet<string>;
    warn?: (message: string, file: string) => void;
}

/** Analyse every model in the project and name the anonymous types that need a C# declaration. */
export function collectHoistedTypes(roots: readonly ContractRootNode[], opts: HoistOptions): HoistResult {
    const state: State = {
        ...opts,
        byNode: new Map(),
        byName: new Map(),
        byFile: new Map(),
        memberships: new Map(),
        taken: new Set(roots.flatMap(r => r.models.map(m => m.name))),
    };

    for (const root of roots) {
        for (const model of root.models) {
            if (model.type) {
                // A model alias occupies a name already, so only a union claims it here: everything
                // else an alias can hold is emitted directly as that model's own declaration.
                walkType(model.type, model.name, root.file, state, true, model.description);
            }
            for (const field of model.fields) {
                walkType(field.type, `${model.name}${toCSharpTypeName(field.name)}`, root.file, state, false, field.description);
            }
        }
    }

    return { byNode: state.byNode, byName: state.byName, byFile: state.byFile, memberships: state.memberships };
}

interface State extends HoistOptions {
    byNode: Map<ContractTypeNode, HoistedDecl>;
    byName: Map<string, HoistedDecl>;
    byFile: Map<string, HoistedDecl[]>;
    memberships: Map<string, string[]>;
    /** Every name already claimed by a model or an earlier hoist, so a new one cannot collide. */
    taken: Set<string>;
}

/**
 * Walk one type, hoisting the nodes that need a name and recursing into the rest.
 *
 * @param atAliasRoot - True when the node is a model's own `type`, i.e. it already has a name.
 *   Only unions are claimed there; other shapes are emitted by the model generator itself.
 */
function walkType(type: ContractTypeNode, path: string, ownerFile: string, state: State, atAliasRoot: boolean, description?: string): void {
    switch (type.kind) {
        case 'union':
            hoistPlainUnion(type, path, ownerFile, state, atAliasRoot, description);
            return;
        case 'discriminatedUnion':
            hoistDiscriminatedUnion(type, path, ownerFile, state, atAliasRoot, description);
            return;
        case 'enum':
            if (!atAliasRoot) {
                hoist(
                    type,
                    { kind: 'enum', name: claimFor(path, state, false), ownerFile, needsInput: false, values: type.values, description },
                    state,
                );
            }
            return;
        case 'inlineObject':
            if (!atAliasRoot) hoistRecord(type, type.fields, path, ownerFile, state, description);
            else type.fields.forEach(f => walkType(f.type, `${path}${toCSharpTypeName(f.name)}`, ownerFile, state, false, f.description));
            return;
        case 'intersection': {
            if (atAliasRoot) {
                type.members.forEach(m => walkType(m, path, ownerFile, state, true));
                return;
            }
            const { fields } = resolveEffectiveFields(type, state.modelIndex);
            hoistRecord(type, fields, path, ownerFile, state, description);
            return;
        }
        case 'tuple':
            type.items.forEach((item, i) => walkType(item, `${path}Item${i}`, ownerFile, state, false));
            // Every arity is hoisted. `ValueTuple` does not serialize as a JSON array, and a
            // property-level `[JsonConverter]` cannot reach a tuple nested inside a `List<>`. A
            // hoisted record carries a type-level converter, which travels everywhere the type does.
            hoist(
                type,
                {
                    kind: 'tuple',
                    name: claimFor(path, state, false),
                    ownerFile,
                    needsInput: type.items.some(t => typeNeedsInput(t, state)),
                    items: type.items,
                    description,
                },
                state,
            );
            return;
        case 'array':
            walkType(type.item, path, ownerFile, state, false);
            return;
        case 'record':
            walkType(type.value, path, ownerFile, state, false);
            return;
        case 'lazy':
            walkType(type.inner, path, ownerFile, state, atAliasRoot, description);
            return;
        default:
            return;
    }
}

function hoistRecord(node: ContractTypeNode, fields: FieldNode[], path: string, ownerFile: string, state: State, description?: string): void {
    const name = claimFor(path, state, false);
    for (const f of fields) walkType(f.type, `${name}${toCSharpTypeName(f.name)}`, ownerFile, state, false, f.description);
    hoist(
        node,
        {
            kind: 'record',
            name,
            ownerFile,
            needsInput: fields.some(f => f.visibility !== 'normal' || typeNeedsInput(f.type, state)),
            fields,
            description,
        },
        state,
    );
}

/**
 * A plain union becomes an abstract record with one nested member record per member, so a caller can
 * switch over it. Two shapes are recognised first because C# expresses them natively: a union whose
 * only non-null member is `T` is just `T?`, and a union of string literals is an enum.
 */
function hoistPlainUnion(
    type: ContractTypeNode & { kind: 'union' },
    path: string,
    ownerFile: string,
    state: State,
    atAliasRoot: boolean,
    description?: string,
): void {
    const nullable = type.members.some(m => m.kind === 'scalar' && m.name === 'null');
    const members = type.members.filter(m => !(m.kind === 'scalar' && m.name === 'null'));

    // `union(T, null)` is C#'s own nullable type; an abstract record would only get in the way.
    if (members.length <= 1) {
        if (members[0]) walkType(members[0], path, ownerFile, state, false);
        return;
    }

    if (members.every(m => m.kind === 'literal' && typeof m.value === 'string')) {
        const values = members.map(m => String((m as ContractTypeNode & { kind: 'literal' }).value));
        hoist(type, { kind: 'enum', name: claimFor(path, state, atAliasRoot), ownerFile, needsInput: false, nullable, values, description }, state);
        return;
    }

    const name = claimFor(path, state, atAliasRoot);
    const used = new Set<string>();
    const hoisted: HoistedMember[] = [];
    for (const member of members) {
        walkType(member, `${name}${toCSharpTypeName(memberLabel(member, state))}`, ownerFile, state, false);
        const typeName = memberTypeName(member, state);
        hoisted.push({ typeName, wrapperName: uniqueIn(`Of${toCSharpTypeName(memberLabel(member, state))}`, used), type: member });
    }

    hoist(
        type,
        {
            kind: 'plainUnion',
            name,
            ownerFile,
            needsInput: members.some(m => typeNeedsInput(m, state)),
            nullable,
            members: hoisted,
            description,
        },
        state,
    );
}

/**
 * A discriminated union becomes an interface its member records implement directly, with a converter
 * that dispatches on the tag. An interface rather than an abstract base: a record has single
 * inheritance, and one contract can belong to several unions. Members must be model refs or inline
 * objects, and the discriminator field must be a `literal` — an `enum` discriminator is legal in the
 * source language but leaves no statically known tag, so the union degrades to a raw JSON value.
 */
function hoistDiscriminatedUnion(
    type: ContractTypeNode & { kind: 'discriminatedUnion' },
    path: string,
    ownerFile: string,
    state: State,
    atAliasRoot: boolean,
    description?: string,
): void {
    const name = claimFor(path, state, atAliasRoot);
    const members: HoistedMember[] = [];

    for (const member of type.members) {
        const { fields } = resolveEffectiveFields(member, state.modelIndex);
        const discriminatorField = fields.find(f => f.name === type.discriminator);
        const tagType = discriminatorField?.type.kind === 'lazy' ? discriminatorField.type.inner : discriminatorField?.type;
        if (!tagType || tagType.kind !== 'literal') {
            state.warn?.(
                `Discriminated union '${name}' has a member whose '${type.discriminator}' is not a literal, so its tag is not known at build time; ` +
                    `emitting a raw JSON value instead of an interface.`,
                ownerFile,
            );
            release(name, state, atAliasRoot);
            return;
        }

        const tag = String(tagType.value);
        if (member.kind === 'ref') {
            members.push({ typeName: member.name, tag, type: member });
        } else {
            // An inline member has no record of its own yet; name it after the tag it carries.
            const memberPath = `${name}${toCSharpTypeName(tag)}`;
            hoistRecord(member, fields, memberPath, ownerFile, state, undefined);
            const decl = state.byNode.get(member);
            if (!decl) {
                release(name, state, atAliasRoot);
                return;
            }
            members.push({ typeName: decl.name, tag, type: member });
        }
    }

    if (members.length === 0) {
        release(name, state, atAliasRoot);
        return;
    }

    const decl: HoistedDecl = {
        kind: 'discriminatedUnion',
        name,
        ownerFile,
        needsInput: type.members.some(m => typeNeedsInput(m, state)),
        members,
        discriminator: type.discriminator,
        description,
    };
    hoist(type, decl, state);

    // The member records declare the interface, wherever in the project they are generated.
    for (const member of members) {
        const list = state.memberships.get(member.typeName) ?? [];
        if (!list.includes(name)) list.push(name);
        state.memberships.set(member.typeName, list);
    }
}

/** A short label for a union member, used to name its member record and any nested hoist. */
function memberLabel(type: ContractTypeNode, state: State): string {
    switch (type.kind) {
        case 'ref':
            return type.name;
        case 'scalar':
            return type.name;
        case 'array':
            return `${memberLabel(type.item, state)}List`;
        case 'record':
            return `${memberLabel(type.value, state)}Map`;
        case 'literal':
            return typeof type.value === 'string' ? type.value : String(type.value);
        case 'lazy':
            return memberLabel(type.inner, state);
        default: {
            const decl = state.byNode.get(type);
            return decl ? decl.name : 'Member';
        }
    }
}

/** The C# type a union member is wrapped around, once any nested hoisting has happened. */
function memberTypeName(type: ContractTypeNode, state: State): string {
    const decl = state.byNode.get(type);
    if (decl) return decl.name;
    if (type.kind === 'ref') return type.name;
    return '';
}

/**
 * Whether rendering `type` for a request body differs from rendering it for a response, i.e. it
 * reaches a model that has a distinct `Input` variant. Drives whether a hoisted declaration needs
 * an `Input` twin of its own.
 */
function typeNeedsInput(type: ContractTypeNode, state: State): boolean {
    const refs = new Set<string>();
    collectTypeRefs(type, refs);
    if ([...refs].some(r => state.modelsWithInput.has(r))) return true;
    return hasVisibilityField(type);
}

function hasVisibilityField(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'inlineObject':
            return type.fields.some(f => f.visibility !== 'normal' || hasVisibilityField(f.type));
        case 'array':
            return hasVisibilityField(type.item);
        case 'record':
            return hasVisibilityField(type.value);
        case 'lazy':
            return hasVisibilityField(type.inner);
        case 'tuple':
            return type.items.some(hasVisibilityField);
        case 'union':
        case 'intersection':
        case 'discriminatedUnion':
            return type.members.some(hasVisibilityField);
        default:
            return false;
    }
}

function hoist(node: ContractTypeNode, decl: HoistedDecl, state: State): void {
    state.byNode.set(node, decl);
    state.byName.set(decl.name, decl);
    const list = state.byFile.get(decl.ownerFile) ?? [];
    list.push(decl);
    state.byFile.set(decl.ownerFile, list);
}

/**
 * Reserve a C# declaration name, suffixing until it is free. The path arrives already composed
 * from PascalCase parts, so it is only sanitized — re-casing it would fold `MV` back to `Mv`.
 *
 * A union that *is* a model's declared type keeps that model's name: it already owns it, and the
 * model generator emits nothing else under it.
 */
function claimFor(path: string, state: State, atAliasRoot: boolean): string {
    if (atAliasRoot) return path;
    return uniqueIn(sanitizeCSharpTypeName(path), state.taken);
}

/** Give a reserved name back, for a hoist that turned out not to be expressible. */
function release(name: string, state: State, atAliasRoot: boolean): void {
    if (!atAliasRoot) state.taken.delete(name);
}

function uniqueIn(base: string, taken: Set<string>): string {
    if (!taken.has(base)) {
        taken.add(base);
        return base;
    }
    let n = 2;
    while (taken.has(`${base}${n}`)) n++;
    taken.add(`${base}${n}`);
    return `${base}${n}`;
}
