import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode, ScalarTypeNode } from '@contractkit/core';
import { buildModelIndex, computeModelsWithInput, resolveEffectiveFields, topoSortModels } from '@contractkit/core';
import type { HoistedDecl, HoistResult } from './hoist.js';
import { quoteCSharpString, safeMemberName, toCSharpEnumMemberName, toCSharpPropertyName, xmlDocLines } from './naming.js';

// ─── Public entry point ────────────────────────────────────────────────────

export interface CSharpModelCodegenOptions {
    /** Root namespace the SDK is generated into. Models land in `<namespace>.Models`. */
    namespace: string;
    /** Model names that have a distinct `Input` variant, including ones declared in other files. */
    modelsWithInput?: ReadonlySet<string>;
    /**
     * Every model in the project, for flattening bases and intersections. Defaults to an index of
     * this root's own models, which is enough for a single-file project and for unit tests.
     */
    modelIndex?: ReadonlyMap<string, ModelNode>;
    /** Names assigned to anonymous types by {@link collectHoistedTypes}, across the whole project. */
    hoisted?: HoistResult;
    warn?: (message: string) => void;
}

/**
 * The `using` block every generated models file carries.
 *
 * There is no import tracker, unlike the Kotlin plugin: every type the models can name is in the
 * base class library, so the set is fixed. An unused `using` is not a compiler warning, and pinning
 * the block keeps the output stable and free of the ordering churn a tracker would produce.
 */
const MODEL_USINGS = [
    'using System;',
    'using System.Collections.Generic;',
    'using System.Numerics;',
    'using System.Text.Json;',
    'using System.Text.Json.Serialization;',
] as const;

/**
 * Generate the C# models file for one contract root: a `sealed record` per model, plus `<Name>Input`
 * variants, enums, aliases, and the records, interfaces and converters standing in for the unions
 * and anonymous shapes this file owns.
 *
 * Every model in the project shares the single `<namespace>.Models` namespace, so a reference to a
 * model declared in another `.ck` file needs no import and resolves by name alone. That is also what
 * lets an interface declared in one file be implemented by a record generated in another.
 */
export function generateCSharpModels(root: ContractRootNode, opts: CSharpModelCodegenOptions): string {
    const modelsWithInput = resolveModelsWithInput(root.models, opts.modelsWithInput);
    const modelIndex = opts.modelIndex ?? buildModelIndex(root.models);

    const ctx: RenderContext = {
        namespace: opts.namespace,
        modelsWithInput,
        modelIndex,
        hoisted: opts.hoisted,
        globalAliases: [],
        warn: opts.warn,
    };

    const bodies: string[] = [];
    const append = (lines: string[]): void => {
        // A model whose type is a union emits nothing here — the hoisting pass owns the declaration
        // named after it — so the blank separator has to be conditional or it leaves a gap behind.
        if (lines.length === 0) return;
        bodies.push('', ...lines);
    };
    for (const model of topoSortModels(root.models)) append(generateModel(model, ctx));
    for (const decl of opts.hoisted?.byFile.get(root.file) ?? []) append(generateHoisted(decl, ctx));

    return renderFile(`${opts.namespace}.Models`, ctx.globalAliases, [...MODEL_USINGS], bodies);
}

/**
 * The complete set of model names that need a distinct `Input` variant: the ones passed in, plus
 * the transitive closure over `models`.
 *
 * The hoisting pass and the renderer both have to agree on this — a hoisted shape whose Input twin
 * one of them thinks is unnecessary would leave the other referring to a type nobody emitted.
 */
export function resolveModelsWithInput(models: readonly ModelNode[], external: ReadonlySet<string> = new Set()): Set<string> {
    const seed = new Set(external);
    return new Set([...seed, ...computeModelsWithInput([...models], seed)]);
}

// ─── Render context ────────────────────────────────────────────────────────

interface RenderContext {
    namespace: string;
    modelsWithInput: ReadonlySet<string>;
    modelIndex: ReadonlyMap<string, ModelNode>;
    hoisted?: HoistResult;
    /** `global using` alias lines this file has to emit above its own `using` block. */
    globalAliases: string[];
    /** When set, type names render fully qualified, as a `global using` alias target must be. */
    qualify?: boolean;
    warn?: (message: string) => void;
}

/** Build a rendering context for a file outside the models namespace, such as a client. */
export function createRenderContext(opts: CSharpModelCodegenOptions & { modelsWithInput: ReadonlySet<string> }): RenderContext {
    return {
        namespace: opts.namespace,
        modelsWithInput: opts.modelsWithInput,
        modelIndex: opts.modelIndex ?? new Map(),
        hoisted: opts.hoisted,
        globalAliases: [],
        warn: opts.warn,
    };
}

/**
 * Assemble a generated C# file: header, nullable context, global aliases, usings, namespace, bodies.
 *
 * `// <auto-generated/>` turns the nullable context off, so `#nullable enable` follows it
 * explicitly. A `global using` alias has to precede every ordinary `using` in its file, which is
 * why the aliases are collected during rendering and emitted here rather than inline.
 */
export function renderFile(namespaceName: string, globalAliases: readonly string[], usings: readonly string[], bodies: string[]): string {
    const lines: string[] = ['// <auto-generated/>', '// Generated by @contractkit/plugin-csharp. Do not edit manually.', '#nullable enable', ''];
    if (globalAliases.length > 0) {
        lines.push(...[...globalAliases].sort());
        lines.push('');
    }
    lines.push(...usings);
    lines.push('');
    lines.push(`namespace ${namespaceName};`);
    lines.push(...bodies);
    lines.push('');
    return lines.join('\n');
}

// ─── Type rendering ────────────────────────────────────────────────────────

/**
 * Render a ContractKit type as its C# type expression. Never returns a nullable type unless the type
 * itself is one — the caller appends `?` from the field's own `optional`/`nullable` flags.
 *
 * @param forInput - When true, a reference to a model or hoisted shape with an Input variant renders
 *   as `<Name>Input`.
 * @throws {Error} Via the scalar renderer, if a scalar has no C# mapping.
 */
export function renderCSharpType(type: ContractTypeNode, ctx: RenderContext, forInput = false): string {
    const decl = ctx.hoisted?.byNode.get(type);
    if (decl) return hoistedTypeName(decl, ctx, forInput);

    switch (type.kind) {
        case 'scalar':
            return renderScalar(type.name, ctx);
        case 'literal':
            return literalCSharpType(type.value, ctx);
        case 'array':
            return `${qualify('List', 'System.Collections.Generic.List', ctx)}<${renderCSharpType(type.item, ctx, forInput)}>`;
        case 'record': {
            const key = renderCSharpType(type.key, ctx, forInput);
            const value = renderCSharpType(type.value, ctx, forInput);
            const stringType = qualify('string', 'System.String', ctx);
            if (key !== stringType) {
                ctx.warn?.(
                    `A record key of type '${key}' is not representable as a JSON object key; emitting Dictionary<string, ${value}>. ` +
                        `Parse the key yourself, or declare the key as a string.`,
                );
            }
            return `${qualify('Dictionary', 'System.Collections.Generic.Dictionary', ctx)}<${stringType}, ${value}>`;
        }
        case 'tuple':
            // Unreachable in the real pipeline: the hoisting pass gives every tuple a record of its
            // own, so the `byNode` lookup above has already returned.
            return jsonElement(ctx);
        case 'ref': {
            const name = forInput && ctx.modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
            return ctx.qualify ? `${ctx.namespace}.Models.${name}` : name;
        }
        case 'lazy':
            return renderCSharpType(type.inner, ctx, forInput);
        case 'union': {
            // A union with at most one non-null member never gets a declaration: it is either C#'s
            // own nullable type or nothing at all.
            const nonNull = type.members.filter(m => !isNullScalar(m));
            const nullable = nonNull.length !== type.members.length;
            if (nonNull.length === 0) return `${qualify('object', 'System.Object', ctx)}?`;
            if (nonNull.length === 1) {
                const inner = renderCSharpType(nonNull[0]!, ctx, forInput);
                return nullable && !inner.endsWith('?') ? `${inner}?` : inner;
            }
            return jsonElement(ctx);
        }
        case 'enum':
        case 'inlineObject':
        case 'intersection':
        case 'discriminatedUnion':
            // Reached only when the shape could not be given a name — a discriminated union whose
            // tag is not statically known, or a caller that skipped the hoisting pass.
            return jsonElement(ctx);
    }
}

function hoistedTypeName(decl: HoistedDecl, ctx: RenderContext, forInput: boolean): string {
    const bare = forInput && decl.needsInput ? `${decl.name}Input` : decl.name;
    const name = ctx.qualify ? `${ctx.namespace}.Models.${bare}` : bare;
    return decl.nullable ? `${name}?` : name;
}

/** Pick the short or the fully-qualified spelling, depending on where the type is being written. */
function qualify(short: string, full: string, ctx: RenderContext): string {
    return ctx.qualify ? full : short;
}

function jsonElement(ctx: RenderContext): string {
    return qualify('JsonElement', 'System.Text.Json.JsonElement', ctx);
}

function isNullScalar(type: ContractTypeNode): boolean {
    return type.kind === 'scalar' && type.name === 'null';
}

/**
 * Map a ContractKit scalar to its C# type.
 *
 * @throws {Error} When a scalar has no mapping, so a scalar added to core fails the build here
 *   rather than emitting C# that does not compile.
 */
export function renderScalar(name: ScalarTypeNode['name'], ctx: RenderContext): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'interval':
            return qualify('string', 'System.String', ctx);
        case 'number':
            return qualify('double', 'System.Double', ctx);
        // `int` is a JS safe integer in the source language, which overflows C#'s 32-bit int.
        case 'int':
            return qualify('long', 'System.Int64', ctx);
        case 'bigint':
            return qualify('BigInteger', 'System.Numerics.BigInteger', ctx);
        // Carried as a quoted string by DecimalStringConverter, never as a JSON number.
        case 'decimal':
            return qualify('decimal', 'System.Decimal', ctx);
        case 'boolean':
            return qualify('bool', 'System.Boolean', ctx);
        case 'date':
            return qualify('DateOnly', 'System.DateOnly', ctx);
        case 'time':
            return qualify('TimeOnly', 'System.TimeOnly', ctx);
        case 'datetime':
            return qualify('DateTimeOffset', 'System.DateTimeOffset', ctx);
        // Carried as ISO 8601 by IsoTimeSpanConverter, not the BCL's own `d.hh:mm:ss`.
        case 'duration':
            return qualify('TimeSpan', 'System.TimeSpan', ctx);
        case 'uuid':
            return qualify('Guid', 'System.Guid', ctx);
        case 'binary':
            return qualify('byte[]', 'System.Byte[]', ctx);
        case 'null':
            return `${qualify('object', 'System.Object', ctx)}?`;
        case 'unknown':
        case 'json':
        case 'object':
            return jsonElement(ctx);
        default: {
            const _exhaustive: never = name;
            throw new Error(`plugin-csharp: unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

function literalCSharpType(value: string | number | boolean, ctx: RenderContext): string {
    if (typeof value === 'string') return qualify('string', 'System.String', ctx);
    if (typeof value === 'boolean') return qualify('bool', 'System.Boolean', ctx);
    return Number.isInteger(value) ? qualify('long', 'System.Int64', ctx) : qualify('double', 'System.Double', ctx);
}

// ─── Default values ────────────────────────────────────────────────────────

/**
 * Render a contract default as a C# expression of the field's own type. Returns `undefined` when the
 * value cannot be expressed, so the field is emitted as `required` rather than with an initializer
 * that will not compile.
 */
function renderDefault(value: string | number | boolean, type: ContractTypeNode, ctx: RenderContext): string | undefined {
    const inner = type.kind === 'lazy' ? type.inner : type;

    if (typeof value === 'boolean') return String(value);

    if (typeof value === 'number') {
        if (inner.kind === 'scalar') {
            switch (inner.name) {
                case 'int':
                    return `${value}L`;
                case 'number':
                    return `${value}d`;
                case 'decimal':
                    return `${value}m`;
                case 'bigint':
                    return Number.isSafeInteger(value) ? `new BigInteger(${value})` : `BigInteger.Parse("${value}")`;
            }
        }
        return Number.isInteger(value) ? `${value}L` : `${value}d`;
    }

    // A string default against an enum names one of its members. When the enum was hoisted into a
    // real C# enum, that is expressible; a bare inline enum has no type to qualify.
    if (inner.kind === 'enum') {
        const decl = ctx.hoisted?.byNode.get(inner);
        if (!decl || !inner.values.includes(value)) return undefined;
        return `${decl.name}.${enumMemberNames(inner.values).get(value)}`;
    }

    // The same default written against a NAMED enum contract — `rating: Rating = "neutral"`, where
    // `contract Rating: enum(...)` — arrives here as a ref rather than as the enum node.
    if (inner.kind === 'ref') {
        const target = ctx.modelIndex.get(inner.name);
        const targetType = target?.type?.kind === 'lazy' ? target.type.inner : target?.type;
        if (targetType?.kind !== 'enum' || !targetType.values.includes(value)) return undefined;
        return `${inner.name}.${enumMemberNames(targetType.values).get(value)}`;
    }

    if (inner.kind === 'scalar') {
        switch (inner.name) {
            case 'decimal':
                return /^-?\d+(\.\d+)?$/.test(value) ? `${value}m` : undefined;
            case 'bigint':
                return /^-?\d+$/.test(value) ? `BigInteger.Parse(${quoteCSharpString(value)})` : undefined;
            case 'string':
            case 'email':
            case 'url':
            case 'interval':
                return quoteCSharpString(value);
            default:
                // date/uuid/datetime and friends have no literal syntax; leave the field required.
                return undefined;
        }
    }
    return quoteCSharpString(value);
}

// ─── Wire key casing ───────────────────────────────────────────────────────

/** The key casing a contract's `format(input=)` / `format(output=)` names. */
type WireCase = NonNullable<ModelNode['outputCase']>;

/**
 * A field name as it travels, which is not always the name the contract declares it under.
 *
 * The two transforms are spelled exactly as `plugin-typescript` spells them, deliberately: the
 * server parses and emits through that plugin's schemas, so a C# client that disagreed with it about
 * where an underscore goes would be wrong in a way no test in either package could see.
 */
function applyWireCase(name: string, wireCase: WireCase | undefined): string {
    if (!wireCase || wireCase === 'camel') return name;
    if (wireCase === 'snake') return name.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    return name.charAt(0).toUpperCase() + name.slice(1);
}

/** A case that actually renames something. `camel` is the identity and is treated as absent. */
function renamingCase(wireCase: WireCase | undefined): WireCase | undefined {
    return wireCase && wireCase !== 'camel' ? wireCase : undefined;
}

/**
 * Which casing one generated record's keys travel in.
 *
 * A response is decoded through `format(output=)` and a request is encoded through `format(input=)`,
 * so a model split into a read record and an `Input` twin takes one each. A model that is NOT split
 * is one record used in both directions, and a `[JsonPropertyName]` cannot spell two different key
 * sets — so a contract asking for two is reported rather than silently resolved in whichever
 * direction happens to be rendered.
 */
function wireCaseFor(model: ModelNode, forInput: boolean, split: boolean, ctx: RenderContext): WireCase | undefined {
    const input = renamingCase(model.inputCase);
    const output = renamingCase(model.outputCase);
    if (split) return forInput ? input : output;
    if (input && output && input !== output) {
        ctx.warn?.(
            `Contract '${model.name}' sets format(input=${input}) and format(output=${output}), but nothing about it splits into an Input variant, ` +
                `so one C# record carries both directions and can only spell one set of keys. The generated keys follow the output casing; ` +
                `a request built from this record will send the wrong ones.`,
        );
        return output;
    }
    return output ?? input;
}

/**
 * Whether a type puts an anonymous object under a renamed model.
 *
 * Such an object is hoisted into a record of its own, which is rendered without the owning model's
 * casing — the hoisting pass records no owner to take it from. That is a real gap rather than a
 * decision, so it is reported at the one place the owner is still known.
 */
function containsInlineObject(type: ContractTypeNode | undefined): boolean {
    if (!type) return false;
    switch (type.kind) {
        case 'inlineObject':
            return true;
        case 'lazy':
            return containsInlineObject(type.inner);
        case 'array':
            return containsInlineObject(type.item);
        case 'record':
            return containsInlineObject(type.value);
        case 'tuple':
            return type.items.some(containsInlineObject);
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            return (type.members ?? []).some(containsInlineObject);
        default:
            return false;
    }
}

/** Report the gap above, once per model rather than once per field. */
function warnUncasedNesting(model: ModelNode, fields: readonly FieldNode[], wireCase: WireCase | undefined, ctx: RenderContext): void {
    if (!wireCase) return;
    if (!fields.some(f => containsInlineObject(f.type)) && !containsInlineObject(model.type)) return;
    ctx.warn?.(
        `Contract '${model.name}' is declared format(${model.outputCase ? 'output' : 'input'}=${wireCase}) and holds an anonymous object. ` +
            `The record hoisted out of that object keeps its declared key names, so its keys will not be ${wireCase}-cased. ` +
            `Name the shape as its own contract to fix it.`,
    );
}

// ─── Model generation ──────────────────────────────────────────────────────

function generateModel(model: ModelNode, ctx: RenderContext): string[] {
    if (model.type) return generateAliasModel(model, ctx);

    const effective = effectiveFieldsFor(model, ctx);
    const needsSplit = ctx.modelsWithInput.has(model.name) || effective.some(f => f.visibility !== 'normal');

    if (!needsSplit) return generateRecordForModel(model.name, effective, ctx, false, model, false);

    const readFields = effective.filter(f => f.visibility !== 'writeonly');
    const inputFields = effective.filter(f => f.visibility !== 'readonly');
    return [
        ...generateRecordForModel(model.name, readFields, ctx, false, model, true),
        '',
        ...generateRecordForModel(`${model.name}Input`, inputFields, ctx, true, model, true),
    ];
}

/**
 * Bases are flattened rather than expressed as C# inheritance. A record can inherit, but a base's
 * `required` properties would then be re-declared by the override rule the contract language
 * applies, and a sealed leaf is what the serializer wants. `resolveEffectiveFields` applies the same
 * later-wins override rule the inheritance validator enforces.
 */
function effectiveFieldsFor(model: ModelNode, ctx: RenderContext): FieldNode[] {
    if (!model.bases || model.bases.length === 0) return model.fields;
    const { fields, unresolved } = resolveEffectiveFields(model.name, ctx.modelIndex);
    for (const name of unresolved) {
        ctx.warn?.(`Contract '${model.name}' extends '${name}', which is not defined; its fields are missing from the generated record.`);
    }
    return fields;
}

function generateAliasModel(model: ModelNode, ctx: RenderContext): string[] {
    const type = model.type!;
    const inner = type.kind === 'lazy' ? type.inner : type;

    // A union alias is emitted by the hoisting pass, which owns the declaration named after it.
    if (ctx.hoisted?.byNode.has(inner)) return [];

    if (inner.kind === 'enum') return generateEnum(model.name, inner.values, ctx, model.description, model.deprecated);

    // An intersection or inline object at model level names a real shape, so it becomes a record
    // rather than an alias to an opaque JSON object.
    if (inner.kind === 'intersection' || inner.kind === 'inlineObject') {
        const { fields, unresolved } = resolveEffectiveFields(inner, ctx.modelIndex);
        for (const name of unresolved) {
            ctx.warn?.(`Contract '${model.name}' references '${name}', which is not defined; its fields are missing from the generated record.`);
        }
        const needsSplit = ctx.modelsWithInput.has(model.name) || fields.some(f => f.visibility !== 'normal');
        if (!needsSplit) return generateRecordForModel(model.name, fields, ctx, false, model, false);
        return [
            ...generateRecordForModel(
                model.name,
                fields.filter(f => f.visibility !== 'writeonly'),
                ctx,
                false,
                model,
                true,
            ),
            '',
            ...generateRecordForModel(
                `${model.name}Input`,
                fields.filter(f => f.visibility !== 'readonly'),
                ctx,
                true,
                model,
                true,
            ),
        ];
    }

    // Everything else is a name for an existing type, which C# spells as a using alias. The target
    // has to be fully qualified: a global alias is resolved without the file's own using block.
    addAlias(model.name, type, ctx, false);
    if (ctx.modelsWithInput.has(model.name)) addAlias(`${model.name}Input`, type, ctx, true);
    return [];
}

/**
 * Record one `global using X = Y;`. A nullable reference type is illegal as an alias target, so the
 * `?` is dropped and the loss reported rather than emitting a file that does not compile.
 */
function addAlias(name: string, type: ContractTypeNode, ctx: RenderContext, forInput: boolean): void {
    const target = renderCSharpType(type, { ...ctx, qualify: true }, forInput);
    let aliased = target;
    if (aliased.endsWith('?') && !isNullableValueType(type, ctx)) {
        aliased = aliased.slice(0, -1);
        ctx.warn?.(
            `Contract '${name}' aliases a nullable type, which C# cannot express as a using alias; ` +
                `'${name}' is generated as '${aliased}'. Declare the nullability at each use site instead.`,
        );
    }
    ctx.globalAliases.push(`global using ${name} = ${aliased};`);
}

/** Whether `type` renders as a nullable *value* type, which is a legal alias target. */
function isNullableValueType(type: ContractTypeNode, ctx: RenderContext): boolean {
    const inner = type.kind === 'lazy' ? type.inner : type;
    if (inner.kind !== 'union') return false;
    const nonNull = inner.members.filter(m => !isNullScalar(m));
    if (nonNull.length !== 1) return false;
    return VALUE_TYPES.has(renderCSharpType(nonNull[0]!, { ...ctx, qualify: false }, false));
}

/** The C# spellings that are value types, so `T?` is `Nullable<T>` rather than a nullable reference. */
const VALUE_TYPES: ReadonlySet<string> = new Set([
    'bool',
    'byte',
    'decimal',
    'double',
    'long',
    'BigInteger',
    'DateOnly',
    'TimeOnly',
    'DateTimeOffset',
    'TimeSpan',
    'Guid',
    'JsonElement',
]);

function enumMemberNames(values: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const used = new Set<string>();
    for (const value of values) out.set(value, uniqueName(toCSharpEnumMemberName(value), used));
    return out;
}

/**
 * A C# enum whose members carry their wire spelling.
 *
 * `JsonStringEnumConverter<T>` plus `[JsonStringEnumMemberName]` is what makes the wire value travel
 * without a converter of the generator's own. Both are framework features, so nothing reflective is
 * generated for an enum.
 */
function generateEnum(name: string, values: string[], ctx: RenderContext, description?: string, deprecated?: boolean): string[] {
    const entries = enumMemberNames(values);
    const lines: string[] = [];
    lines.push(...docLines(description, deprecated, ''));
    lines.push(`[JsonConverter(typeof(JsonStringEnumConverter<${name}>))]`);
    lines.push(`public enum ${name}`);
    lines.push('{');
    values.forEach((value, index) => {
        if (index > 0) lines.push('');
        lines.push(`    [JsonStringEnumMemberName(${quoteCSharpString(value)})]`);
        lines.push(`    ${entries.get(value)},`);
    });
    lines.push('}');
    // An enum has no fields, so no visibility can differ between reading and writing it.
    if (ctx.modelsWithInput.has(name)) ctx.globalAliases.push(`global using ${name}Input = ${ctx.namespace}.Models.${name};`);
    return lines;
}

/** The union interfaces a generated record has to declare it implements. */
function supertypesFor(readName: string, ctx: RenderContext, forInput: boolean): string[] {
    const unions = ctx.hoisted?.memberships.get(readName) ?? [];
    return unions.map(union => {
        const decl = ctx.hoisted?.byName.get(union);
        return forInput && decl?.needsInput ? `${union}Input` : union;
    });
}

function generateRecordForModel(
    name: string,
    fields: FieldNode[],
    ctx: RenderContext,
    forInput: boolean,
    model: ModelNode,
    split: boolean,
): string[] {
    const readName = forInput && name.endsWith('Input') ? name.slice(0, -'Input'.length) : name;
    const wireCase = wireCaseFor(model, forInput, split, ctx);
    // Once per model rather than once per generated record, so a split model does not say it twice.
    if (!forInput) warnUncasedNesting(model, fields, wireCase, ctx);
    return renderRecord(name, fields, ctx, forInput, supertypesFor(readName, ctx, forInput), model.description, model.deprecated, wireCase);
}

function renderRecord(
    name: string,
    fields: FieldNode[],
    ctx: RenderContext,
    forInput: boolean,
    supertypes: string[],
    description?: string,
    deprecated?: boolean,
    wireCase?: WireCase,
): string[] {
    const lines: string[] = [];
    lines.push(...docLines(description, deprecated, ''));
    const implementsClause = supertypes.length > 0 ? ` : ${supertypes.join(', ')}` : '';

    // A contract with no visible fields still has to produce a serializable type.
    if (fields.length === 0) {
        lines.push(`public sealed record ${name}${implementsClause};`);
        return lines;
    }

    lines.push(`public sealed record ${name}${implementsClause}`);
    lines.push('{');
    fields.forEach((field, index) => {
        if (index > 0) lines.push('');
        lines.push(...renderField(field, ctx, forInput, name, wireCase));
    });
    lines.push('}');
    return lines;
}

/**
 * One property.
 *
 * The `optional` and `nullable` flags are kept apart, which the Kotlin plugin cannot do: its
 * `explicitNulls = false` is one global switch, so a required-nullable null is dropped from the
 * payload along with the absent optionals. Here each property says for itself whether a null is
 * written, so `x: T | null` sends `null` and `x?: T` sends nothing.
 *
 * Every property is `required` or carries an initializer, so the record is fully assigned under
 * `#nullable enable` and the generated SDK compiles with warnings as errors. `required` is never
 * combined with `[JsonIgnore]`, which System.Text.Json rejects at run time.
 */
function renderField(field: FieldNode, ctx: RenderContext, forInput: boolean, ownerTypeName: string, wireCase?: WireCase): string[] {
    const propName = safeMemberName(toCSharpPropertyName(field.name), ownerTypeName);
    const wireName = applyWireCase(field.name, wireCase);

    let typeStr = renderCSharpType(field.type, ctx, forInput);
    if ((field.optional || field.nullable) && !typeStr.endsWith('?')) typeStr += '?';

    let initializer = field.default !== undefined ? renderDefault(field.default, field.type, ctx) : undefined;
    // A `literal()` field carries exactly one value, so it defaults to it rather than being asked
    // for at every call site. The property is ordinary, so the value always reaches the wire.
    if (initializer === undefined && !field.optional && !field.nullable) {
        const inner = field.type.kind === 'lazy' ? field.type.inner : field.type;
        if (inner.kind === 'literal') initializer = renderDefault(inner.value, inner, ctx);
    }

    const isRequired = !field.optional && initializer === undefined;

    const lines: string[] = [];
    lines.push(...docLines(field.description, field.deprecated, '    '));
    lines.push(`    [JsonPropertyName(${quoteCSharpString(wireName)})]`);
    if (field.optional) lines.push('    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]');
    const suffix = initializer !== undefined ? ` = ${initializer};` : '';
    lines.push(`    public ${isRequired ? 'required ' : ''}${typeStr} ${propName} { get; init; }${suffix}`);
    return lines;
}

// ─── Hoisted declarations ──────────────────────────────────────────────────

/** Emit the declaration standing in for one anonymous type, plus its Input twin when it needs one. */
function generateHoisted(decl: HoistedDecl, ctx: RenderContext): string[] {
    const read = generateHoistedVariant(decl, ctx, false);
    if (!decl.needsInput) return read;
    return [...read, '', ...generateHoistedVariant(decl, ctx, true)];
}

function generateHoistedVariant(decl: HoistedDecl, ctx: RenderContext, forInput: boolean): string[] {
    const name = forInput ? `${decl.name}Input` : decl.name;
    switch (decl.kind) {
        case 'enum':
            return generateEnum(name, decl.values ?? [], ctx, decl.description);
        case 'record':
            return renderRecord(
                name,
                (decl.fields ?? []).filter(f => (forInput ? f.visibility !== 'readonly' : f.visibility !== 'writeonly')),
                ctx,
                forInput,
                supertypesFor(decl.name, ctx, forInput),
                decl.description,
            );
        case 'tuple':
            return generateTupleRecord(decl, name, ctx, forInput);
        case 'plainUnion':
            return generatePlainUnion(decl, name, ctx, forInput);
        case 'discriminatedUnion':
            return generateDiscriminatedUnion(decl, name, ctx, forInput);
    }
}

/** `element.Deserialize<T>(options)!`, the read expression a generated converter uses per member. */
function deserializeExpr(type: ContractTypeNode, ctx: RenderContext, forInput: boolean): string {
    return `element.Deserialize<${renderCSharpType(type, ctx, forInput)}>(options)!`;
}

/**
 * A contract tuple. It travels as a JSON array, which no BCL type does: `ValueTuple` serializes as
 * an object, and a property-level `[JsonConverter]` cannot reach a tuple nested inside a `List<>`.
 * A record with a type-level converter travels correctly wherever the type appears.
 */
function generateTupleRecord(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    const items = decl.items ?? [];
    const converterName = `${name}Converter`;
    const parameters = items.map((item, index) => `${renderCSharpType(item, ctx, forInput)} Item${index}`).join(', ');

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`[JsonConverter(typeof(${converterName}))]`);
    lines.push(`public sealed record ${name}(${parameters});`);
    lines.push('');
    lines.push(`/// <summary>Reads and writes <see cref="${name}"/> as a JSON array.</summary>`);
    lines.push(`public sealed class ${converterName} : JsonConverter<${name}>`);
    lines.push('{');
    lines.push(`    public override ${name} Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        using var document = JsonDocument.ParseValue(ref reader);');
    lines.push('        var array = document.RootElement;');
    lines.push(`        if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() != ${items.length})`);
    lines.push('        {');
    lines.push(`            throw new JsonException("Expected a JSON array of ${items.length} elements for ${name}.");`);
    lines.push('        }');
    lines.push('');
    lines.push(`        return new ${name}(`);
    items.forEach((item, index) => {
        const expr = `array[${index}].Deserialize<${renderCSharpType(item, ctx, forInput)}>(options)!`;
        lines.push(`            ${expr}${index === items.length - 1 ? '' : ','}`);
    });
    lines.push('        );');
    lines.push('    }');
    lines.push('');
    lines.push(`    public override void Write(Utf8JsonWriter writer, ${name} value, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        writer.WriteStartArray();');
    items.forEach((_, index) => lines.push(`        JsonSerializer.Serialize(writer, value.Item${index}, options);`));
    lines.push('        writer.WriteEndArray();');
    lines.push('    }');
    lines.push('}');
    return lines;
}

/**
 * A plain `union(A | B)` becomes an abstract record with one nested member record per member, so
 * callers get a closed set to switch over instead of an untyped JSON value. The private constructor
 * is what closes it: only the nested records can derive from it.
 *
 * Decoding tries each member in declaration order and takes the first that parses, which is exactly
 * what Zod's `z.union` does on the server. Anything else would let the client and the service
 * disagree about a payload both of them accept.
 */
function generatePlainUnion(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    const converterName = `${name}Converter`;
    const members = decl.members ?? [];

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`[JsonConverter(typeof(${converterName}))]`);
    lines.push(`public abstract record ${name}`);
    lines.push('{');
    lines.push(`    private ${name}() { }`);
    for (const member of members) {
        lines.push('');
        lines.push(`    public sealed record ${member.wrapperName}(${renderCSharpType(member.type, ctx, forInput)} Value) : ${name};`);
    }
    lines.push('}');
    lines.push('');
    lines.push(`/// <summary>Reads <see cref="${name}"/> by trying each member in declaration order.</summary>`);
    lines.push(`public sealed class ${converterName} : JsonConverter<${name}>`);
    lines.push('{');
    lines.push(`    public override ${name} Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        using var document = JsonDocument.ParseValue(ref reader);');
    lines.push('        var element = document.RootElement;');
    lines.push('');
    for (const member of members) {
        lines.push('        try');
        lines.push('        {');
        lines.push(`            return new ${name}.${member.wrapperName}(${deserializeExpr(member.type, ctx, forInput)});`);
        lines.push('        }');
        lines.push('        catch (JsonException)');
        lines.push('        {');
        lines.push('            // Not this member; fall through to the next.');
        lines.push('        }');
        lines.push('');
    }
    lines.push(`        throw new JsonException("No ${name} member matched the payload.");`);
    lines.push('    }');
    lines.push('');
    lines.push(`    public override void Write(Utf8JsonWriter writer, ${name} value, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        switch (value)');
    lines.push('        {');
    for (const member of members) {
        lines.push(`            case ${name}.${member.wrapperName} member:`);
        lines.push('                JsonSerializer.Serialize(writer, member.Value, options);');
        lines.push('                break;');
    }
    lines.push('            default:');
    lines.push(`                throw new JsonException($"Unknown ${name} member {value.GetType().Name}.");`);
    lines.push('        }');
    lines.push('    }');
    lines.push('}');
    return lines;
}

/**
 * A `discriminated(by=tag, A | B)` becomes an interface its member records implement, with a
 * converter that dispatches on the tag value.
 *
 * An interface rather than an abstract base record: a record has single inheritance, and the
 * hoisting pass allows one contract to belong to several unions. It is also why the tag stays a real
 * property on each member rather than becoming `[JsonPolymorphic]` metadata, which System.Text.Json
 * refuses to pair with a property of the same name.
 */
function generateDiscriminatedUnion(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    const converterName = `${name}Converter`;
    const members = (decl.members ?? []).map(member => ({ ...member, recordName: memberRecordName(member.typeName, ctx, forInput) }));
    const discriminator = decl.discriminator ?? '';

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`[JsonConverter(typeof(${converterName}))]`);
    lines.push(`public interface ${name}`);
    lines.push('{');
    lines.push('}');
    lines.push('');
    lines.push(`/// <summary>Reads <see cref="${name}"/> by dispatching on its '${discriminator}' tag.</summary>`);
    lines.push(`public sealed class ${converterName} : JsonConverter<${name}>`);
    lines.push('{');
    lines.push(`    public override ${name} Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        using var document = JsonDocument.ParseValue(ref reader);');
    lines.push('        var element = document.RootElement;');
    lines.push(
        `        var tag = element.TryGetProperty(${quoteCSharpString(discriminator)}, out var tagElement) && tagElement.ValueKind == JsonValueKind.String`,
    );
    lines.push('            ? tagElement.GetString()');
    lines.push('            : null;');
    lines.push('');
    lines.push('        return tag switch');
    lines.push('        {');
    for (const member of members) {
        lines.push(`            ${quoteCSharpString(member.tag ?? '')} => element.Deserialize<${member.recordName}>(options)!,`);
    }
    lines.push(`            _ => throw new JsonException($"Unknown ${name} ${discriminator}: {tag}"),`);
    lines.push('        };');
    lines.push('    }');
    lines.push('');
    lines.push(`    public override void Write(Utf8JsonWriter writer, ${name} value, JsonSerializerOptions options)`);
    lines.push('    {');
    lines.push('        switch (value)');
    lines.push('        {');
    for (const member of members) {
        lines.push(`            case ${member.recordName} member:`);
        lines.push('                JsonSerializer.Serialize(writer, member, options);');
        lines.push('                break;');
    }
    lines.push('            default:');
    lines.push(`                throw new JsonException($"Unknown ${name} member {value.GetType().Name}.");`);
    lines.push('        }');
    lines.push('    }');
    lines.push('}');
    return lines;
}

/** The concrete record name of a union member, in the read or input variant. */
function memberRecordName(typeName: string, ctx: RenderContext, forInput: boolean): string {
    if (!forInput) return typeName;
    const decl = ctx.hoisted?.byName.get(typeName);
    if (decl) return decl.needsInput ? `${typeName}Input` : typeName;
    return ctx.modelsWithInput.has(typeName) ? `${typeName}Input` : typeName;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

/**
 * XML doc for a declaration. Deprecation is a `<remarks>` line rather than `[Obsolete]`: an obsolete
 * model would raise CS0618 in every generated converter and client that names it, which the
 * compile check treats as an error. Operations, which nothing generated calls, do get `[Obsolete]`.
 */
function docLines(description: string | undefined, deprecated: boolean | undefined, indent: string): string[] {
    const lines: string[] = [];
    if (description) lines.push(...xmlDocLines(description, indent));
    if (deprecated) lines.push(...xmlDocLines('Deprecated in the contract.', indent, 'remarks'));
    return lines;
}

function uniqueName(name: string, used: Set<string>): string {
    if (!used.has(name)) {
        used.add(name);
        return name;
    }
    let n = 2;
    while (used.has(`${name}${n}`)) n++;
    used.add(`${name}${n}`);
    return `${name}${n}`;
}

export type { RenderContext };
