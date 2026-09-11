import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode } from '@contractkit/core';
import { collectTypeRefs } from '@contractkit/core';
import { quoteKey, renderTsType, withFieldJsDoc } from './ts-render.js';
import type { TsRenderTarget } from './ts-render.js';

/**
 * The request side of `format(input=)`.
 *
 * A contract declared `format(input=pascal)` compiles to a schema that parses `PascalCase` keys and
 * hands the service camelCase (or the `format(output=)` casing). The model's own TypeScript type
 * describes that post-transform shape, so an SDK that typed a request body with it would ask the
 * caller for keys the server's schema rejects. `XWireInput` is the type a request is sent in: the
 * keys the server parses, at every level.
 *
 * It is a rendered interface rather than `z.input<typeof X>`. That alias would get every key right,
 * but `int`, `datetime`, `decimal` and the other coercing scalars compile to `z.preprocess`, whose
 * input type is `unknown`, so it would accept `ExpiresIn: 'soon'`. A plain-types SDK has no schema to
 * take `z.input` of anyway, and one renderer keeps the two SDK flavours in agreement.
 */

/** A key casing a `format()` modifier can name. */
type KeyCase = NonNullable<ModelNode['inputCase']>;

/** A case that actually renames something. `camel` is the identity and is treated as absent. */
export function renamingCase(keyCase: KeyCase | undefined): 'snake' | 'pascal' | undefined {
    return keyCase && keyCase !== 'camel' ? keyCase : undefined;
}

/** A field name in the given casing, spelled exactly as the schema's `.transform()` spells it. */
export function applyKeyCase(name: string, keyCase: KeyCase | undefined): string {
    if (keyCase === 'snake') return name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    if (keyCase === 'pascal') return name.charAt(0).toUpperCase() + name.slice(1);
    return name;
}

/**
 * Inline every base into a contract whose keys a `format()` renames.
 *
 * A `format()` schema compiles to a `ZodPipe` (`object().transform()`), which has no `.extend()` and
 * no `.shape`, so neither a child of one nor a `format()` contract with a plain base can be built
 * by extension. Both get one flat object instead: each base's fields in declaration order, then the
 * contract's own, a later name replacing an earlier one exactly as `.extend()` would. The casing is
 * the contract's own, else the first base's that sets one; the object mode is its own, else its
 * first base's, which is what `.extend()` would have kept.
 *
 * Returns the model unchanged when no casing applies, preserving the `.extend()`-based output.
 *
 * @param modelMap Every model the bases may name. Pass all files' models: a base in another file
 * still has to contribute its fields, since the flattened schema cannot extend it.
 */
export function flattenFormatChain(model: ModelNode, modelMap: Map<string, ModelNode>): ModelNode {
    return flatten(model, modelMap, new Set());
}

function flatten(model: ModelNode, modelMap: Map<string, ModelNode>, chain: Set<string>): ModelNode {
    if (!model.bases || model.bases.length === 0 || chain.has(model.name)) return model;
    // A cycle is reported by validate-inheritance; stopping here only keeps codegen from recursing.
    const inner = new Set(chain).add(model.name);
    const bases = model.bases.flatMap(b => {
        const base = modelMap.get(b);
        return base && !base.type ? [flatten(base, modelMap, inner)] : [];
    });
    const inputCase = model.inputCase ?? bases.find(b => b.inputCase !== undefined)?.inputCase;
    const outputCase = model.outputCase ?? bases.find(b => b.outputCase !== undefined)?.outputCase;
    if (!renamingCase(inputCase) && !renamingCase(outputCase)) return model;

    const merged = new Map<string, FieldNode>();
    for (const base of bases) for (const f of inheritedFields(base, modelMap, inner)) merged.set(f.name, f);
    for (const f of model.fields) merged.set(f.name, f);

    return {
        ...model,
        bases: undefined,
        fields: [...merged.values()],
        inputCase,
        outputCase,
        mode: model.mode ?? bases[0]?.mode,
    };
}

/** Every field a model carries, its bases' included, for a model {@link flatten} left unflattened. */
function inheritedFields(model: ModelNode, modelMap: Map<string, ModelNode>, chain: Set<string>): FieldNode[] {
    if (!model.bases || model.bases.length === 0 || chain.has(model.name)) return model.fields;
    const inner = new Set(chain).add(model.name);
    const merged = new Map<string, FieldNode>();
    for (const b of model.bases) {
        const base = modelMap.get(b);
        if (base && !base.type) for (const f of inheritedFields(flatten(base, modelMap, inner), modelMap, inner)) merged.set(f.name, f);
    }
    for (const f of model.fields) merged.set(f.name, f);
    return [...merged.values()];
}

/**
 * The key casings a model's request schema actually applies.
 *
 * Mirrors `generateContract`: a contract's own or inherited `format()` applies to its single schema,
 * or to both the read and the `Input` schema of one split for readonly/writeonly fields. A type alias
 * ignores it. The SDK has to send what the server parses, so it follows the same rule.
 */
function appliedCasing(model: ModelNode, modelMap: Map<string, ModelNode>): { input?: 'snake' | 'pascal'; output?: 'snake' | 'pascal' } {
    if (model.type) return {};
    const effective = flattenFormatChain(model, modelMap);
    return { input: renamingCase(effective.inputCase), output: renamingCase(effective.outputCase) };
}

/** Every model name `model` mentions: its fields, its bases, and a type alias's expression. */
function directRefs(model: ModelNode): Set<string> {
    const refs = new Set<string>();
    for (const field of model.fields) collectTypeRefs(field.type, refs);
    for (const base of model.bases ?? []) refs.add(base);
    if (model.type) collectTypeRefs(model.type, refs);
    return refs;
}

/** Grow `seed` with every model that references a member, until nothing changes. */
function closeOverRefs(models: ModelNode[], seed: Set<string>): Set<string> {
    const result = new Set(seed);
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of models) {
            if (result.has(model.name)) continue;
            if ([...directRefs(model)].some(ref => result.has(ref))) {
                result.add(model.name);
                changed = true;
            }
        }
    }
    return result;
}

/**
 * Which models need an `XWireInput` type: those whose SDK request type would otherwise carry keys the
 * server's schema does not parse.
 *
 * The answer depends on how the SDK spells the model's own type, so it differs by flavour:
 *
 * - `plain`: every interface carries the keys as declared. A model is affected when it, or anything
 *   it references, is keyed by `format(input=)`.
 * - `zod`: a model's type is `z.output` of its schema (`z.infer`), and a nested schema contributes
 *   its post-transform keys. So a model referencing *any* re-keying schema is affected, including
 *   one that only has `format(output=)`. The exception is a model whose only transform is its own
 *   `format(output=)`: its type is already `z.input`, which is the wire shape.
 *
 * A model split for readonly/writeonly fields follows the same rule, applied to its `Input` type,
 * which is what a request sends.
 *
 * @param models Every model in scope, across all files, so a reference into another file counts.
 */
export function computeModelsWithWireInput(models: ModelNode[], flavor: 'zod' | 'plain'): Set<string> {
    const modelMap = new Map(models.map(m => [m.name, m]));
    const casing = new Map(models.map(m => [m.name, appliedCasing(m, modelMap)]));

    const inputKeyed = new Set(models.filter(m => casing.get(m.name)!.input).map(m => m.name));
    if (flavor === 'plain') return closeOverRefs(models, inputKeyed);

    const transformed = closeOverRefs(models, new Set(models.filter(m => casing.get(m.name)!.input || casing.get(m.name)!.output).map(m => m.name)));
    const result = new Set<string>();
    for (const model of models) {
        const { input, output } = casing.get(model.name)!;
        if (output && !input) continue;
        if (input || [...directRefs(model)].some(ref => transformed.has(ref))) result.add(model.name);
    }
    return result;
}

// ─── Rendering ─────────────────────────────────────────────────────────────

/** What the `XWireInput` renderer needs to resolve names and scalars. */
export interface WireInputRenderContext {
    /** Models split into a read and an `Input` schema. */
    modelsWithInput: Set<string>;
    /** Models that get an `XWireInput`, from {@link computeModelsWithWireInput}. */
    modelsWithWireInput: Set<string>;
    /** Every model a base may name, across files: the same map the schema generator flattens with. */
    modelMap: Map<string, ModelNode>;
    target: TsRenderTarget;
    /** How the file spells the `json` scalar: `JsonValue` in plain types, `_JsonValue` beside Zod. */
    jsonType: string;
    /** When set, collects every type name rendered, mapped to the model it belongs to. */
    refs?: Map<string, string>;
}

/** A referenced model's request-side name: its `WireInput` type, else its `Input` type, else itself. */
function requestName(name: string, ctx: WireInputRenderContext): string {
    const rendered = ctx.modelsWithWireInput.has(name) ? `${name}WireInput` : ctx.modelsWithInput.has(name) ? `${name}Input` : name;
    ctx.refs?.set(rendered, name);
    return rendered;
}

/**
 * Render a contract type as the TypeScript a request sends.
 *
 * `keyCase` re-keys inline objects, which is how the schema generator treats them: a `format(input=)`
 * model's transform reaches every anonymous object below it, through arrays, unions, intersections
 * and `lazy()`, but not into a tuple or a record, and never into a referenced model, which keys itself.
 */
export function renderWireInputTsType(type: ContractTypeNode, ctx: WireInputRenderContext, keyCase?: 'snake' | 'pascal'): string {
    const recurse = (t: ContractTypeNode) => renderWireInputTsType(t, ctx, keyCase);
    switch (type.kind) {
        case 'ref':
            return requestName(type.name, ctx);
        case 'scalar':
            return type.name === 'json' ? ctx.jsonType : renderTsType(type, ctx.target);
        case 'array': {
            const inner = recurse(type.item);
            const needsParens =
                type.item.kind === 'union' ||
                type.item.kind === 'discriminatedUnion' ||
                type.item.kind === 'intersection' ||
                type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(i => renderWireInputTsType(i, ctx)).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key, ctx.target)}, ${renderWireInputTsType(type.value, ctx)}>`;
        case 'union':
        case 'discriminatedUnion':
            return type.members.map(recurse).join(' | ');
        case 'intersection':
            return type.members.map(recurse).join(' & ');
        case 'lazy':
            return recurse(type.inner);
        case 'inlineObject':
            return `{ ${type.fields.map(f => fieldDeclaration(f, ctx, keyCase)).join('; ')} }`;
        default:
            return renderTsType(type, ctx.target);
    }
}

/** `key?: Type`, optional when the schema lets the caller leave it out: `?`, or a default. */
function fieldDeclaration(field: FieldNode, ctx: WireInputRenderContext, keyCase: 'snake' | 'pascal' | undefined): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    const nullable = field.nullable ? ' | null' : '';
    return `${quoteKey(applyKeyCase(field.name, keyCase))}${opt}: ${renderWireInputTsType(field.type, ctx, keyCase)}${nullable}`;
}

/**
 * Names of fields the declaration replaces in a base: an explicit `override`, or a name a base
 * already has. Omitted from each base so the redeclaration can change the type.
 */
function shadowedNames(fields: FieldNode[], bases: string[], modelMap: Map<string, ModelNode>): string[] {
    const inherited = new Set<string>();
    const visit = (name: string): void => {
        const base = modelMap.get(name);
        if (!base || base.type) return;
        for (const f of base.fields) inherited.add(f.name);
        for (const b of base.bases ?? []) visit(b);
    };
    for (const b of bases) visit(b);
    return fields.filter(f => f.override || inherited.has(f.name)).map(f => f.name);
}

/**
 * Emit `export interface XWireInput` (or `export type` for a type alias) for one model.
 *
 * The shape follows the schema the server parses the request with:
 * - A model with an applied `format()` is one flat object of every field it carries, its bases'
 *   included, keyed by `format(input=)`. Its bases are not extended, because its schema, a pipe,
 *   cannot extend them either.
 * - Any other model extends its bases, each resolved to its request-side name.
 * - A model split for `readonly`/`writeonly` leaves out its readonly fields, as its `Input` schema
 *   does, and is keyed by `format(input=)` like any other.
 */
export function renderWireInputModel(model: ModelNode, ctx: WireInputRenderContext): string[] {
    const name = `${model.name}WireInput`;
    const lines = [`/** {@link ${model.name}} as a request sends it, keyed the way the server's schema parses it. */`];

    if (model.type) {
        lines.push(`export type ${name} = ${renderWireInputTsType(model.type, ctx)};`);
        return lines;
    }

    const split = ctx.modelsWithInput.has(model.name);
    const effective = flattenFormatChain(model, ctx.modelMap);
    const { input, output } = appliedCasing(model, ctx.modelMap);
    const bases = input || output ? [] : (effective.bases ?? []);
    const fields = split ? effective.fields.filter(f => f.visibility !== 'readonly') : effective.fields;

    const shadowed = shadowedNames(effective.fields, bases, ctx.modelMap);
    const omit = shadowed.length > 0 ? shadowed.map(n => `'${n}'`).join(' | ') : undefined;
    const heritage = bases.map(b => (omit ? `Omit<${requestName(b, ctx)}, ${omit}>` : requestName(b, ctx)));
    lines.push(`export interface ${name}${heritage.length > 0 ? ` extends ${heritage.join(', ')}` : ''} {`);
    for (const field of fields) {
        const jsdoc: string[] = [];
        if (field.deprecated) jsdoc.push('@deprecated');
        if (field.description) jsdoc.push(field.description);
        lines.push(`    ${withFieldJsDoc(jsdoc, `${fieldDeclaration(field, ctx, input)};`)}`);
    }
    lines.push('}');
    return lines;
}

/**
 * The names the `XWireInput` types of `root` reference from other files, for the import block.
 *
 * Found by rendering them into a collector, so the imports cannot disagree with the declarations.
 */
export function collectExternalWireInputRefs(root: ContractRootNode, ctx: WireInputRenderContext): string[] {
    const refs = new Map<string, string>();
    for (const model of root.models) {
        if (ctx.modelsWithWireInput.has(model.name)) renderWireInputModel(model, { ...ctx, refs });
    }
    const localNames = new Set(root.models.map(m => m.name));
    return [...refs]
        .filter(([, owner]) => !localNames.has(owner))
        .map(([rendered]) => rendered)
        .sort();
}
