import type { ContractRootNode, ContractTypeNode, FieldNode, ModelNode, ScalarTypeNode } from '@contractkit/core';
import { buildModelIndex, computeModelsWithInput, resolveEffectiveFields, topoSortModels } from '@contractkit/core';
import type { HoistedDecl, HoistResult } from './hoist.js';
import { kdocLines, toKotlinEnumEntryName, toKotlinPropertyName } from './naming.js';

// ─── Public entry point ────────────────────────────────────────────────────

export interface KotlinModelCodegenOptions {
    /** Kotlin package the SDK is generated into. Models land in `<packageName>.models`. */
    packageName: string;
    /** Model names that have a distinct `Input` variant, including ones declared in other files. */
    modelsWithInput?: ReadonlySet<string>;
    /**
     * Every model in the project, for flattening bases and intersections. Defaults to an index of
     * this root's own models, which is enough for a single-file project and for unit tests.
     */
    modelIndex?: ReadonlyMap<string, ModelNode>;
    /** Names assigned to anonymous types by {@link collectHoistedTypes}, across the whole project. */
    hoisted?: HoistResult;
    /**
     * Package holding the generated models. Set only when rendering a file outside that package —
     * a client — so referencing a model registers an import. The models file leaves it unset,
     * since every model is its own neighbour.
     */
    modelsPackage?: string;
    warn?: (message: string) => void;
}

/**
 * Generate the Kotlin models file for one contract root: a `@Serializable data class` per model,
 * plus `<Name>Input` variants, enum classes, type aliases, and the sealed interfaces standing in
 * for the unions and anonymous shapes this file owns.
 *
 * Every model in the project shares the single `<packageName>.models` package, so a reference to a
 * model declared in another `.ck` file needs no import and resolves by name alone. That is also
 * what lets a sealed interface declared in one file be implemented by a class generated in another.
 */
export function generateKotlinModels(root: ContractRootNode, opts: KotlinModelCodegenOptions): string {
    const modelsWithInput = resolveModelsWithInput(root.models, opts.modelsWithInput);
    const modelIndex = opts.modelIndex ?? buildModelIndex(root.models);

    const ctx: RenderContext = {
        packageName: opts.packageName,
        modelsWithInput,
        modelIndex,
        hoisted: opts.hoisted,
        imports: new ImportTracker(),
        warn: opts.warn,
    };

    const bodies: string[] = [];
    const append = (lines: string[]): void => {
        // A model whose type is a union emits nothing here — the hoisting pass owns its sealed
        // interface — so the blank separator has to be conditional or it leaves a gap behind.
        if (lines.length === 0) return;
        bodies.push('', ...lines);
    };
    for (const model of topoSortModels(root.models)) append(generateModel(model, ctx));
    for (const decl of opts.hoisted?.byFile.get(root.file) ?? []) append(generateHoisted(decl, ctx));

    return renderFile(`${opts.packageName}.models`, ctx.imports, bodies);
}

/**
 * The complete set of model names that need a distinct `Input` variant: the ones passed in, plus
 * the transitive closure over `models`.
 *
 * The hoisting pass and the renderer both have to agree on this — a hoisted shape whose Input twin
 * one of them thinks is unnecessary would leave the other referring to a class nobody emitted.
 */
export function resolveModelsWithInput(models: readonly ModelNode[], external: ReadonlySet<string> = new Set()): Set<string> {
    const seed = new Set(external);
    return new Set([...seed, ...computeModelsWithInput([...models], seed)]);
}

// ─── Render context and imports ────────────────────────────────────────────

interface RenderContext {
    packageName: string;
    modelsWithInput: ReadonlySet<string>;
    modelIndex: ReadonlyMap<string, ModelNode>;
    hoisted?: HoistResult;
    modelsPackage?: string;
    imports: ImportTracker;
    warn?: (message: string) => void;
}

/** Build a rendering context for a file outside the models package, such as a client. */
export function createRenderContext(opts: KotlinModelCodegenOptions & { modelsWithInput: ReadonlySet<string> }): RenderContext {
    return {
        packageName: opts.packageName,
        modelsWithInput: opts.modelsWithInput,
        modelIndex: opts.modelIndex ?? new Map(),
        hoisted: opts.hoisted,
        modelsPackage: opts.modelsPackage,
        imports: new ImportTracker(),
        warn: opts.warn,
    };
}

/**
 * Collects the fully-qualified names a generated file imports. Kotlin has no import grouping
 * convention the compiler enforces, so one sorted block keeps the output stable across runs.
 */
export class ImportTracker {
    private readonly names = new Set<string>();
    /** Opt-in markers that have to appear in a `@file:OptIn(...)` annotation above `package`. */
    private readonly optIns = new Set<string>();

    add(fqName: string): void {
        this.names.add(fqName);
    }

    /** Require `@file:OptIn(<marker>::class)`; `fqName` is the marker annotation's own import. */
    addOptIn(marker: string, fqName: string): void {
        this.optIns.add(marker);
        this.names.add(fqName);
    }

    render(): string[] {
        return [...this.names].sort().map(n => `import ${n}`);
    }

    renderFileOptIn(): string[] {
        if (this.optIns.size === 0) return [];
        const markers = [...this.optIns].sort().map(m => `${m}::class`);
        return [`@file:OptIn(${markers.join(', ')})`, ''];
    }
}

/** Assemble a generated Kotlin file: header, file-level opt-ins, package, imports, then bodies. */
export function renderFile(packageName: string, imports: ImportTracker, bodies: string[]): string {
    const lines: string[] = ['// Auto-generated by @contractkit/plugin-kotlin. Do not edit manually.'];
    lines.push(...imports.renderFileOptIn());
    lines.push(`package ${packageName}`);
    const importLines = imports.render();
    if (importLines.length > 0) {
        lines.push('');
        lines.push(...importLines);
    }
    lines.push(...bodies);
    lines.push('');
    return lines.join('\n');
}

// ─── Type rendering ────────────────────────────────────────────────────────

/**
 * Render a ContractKit type as its Kotlin type expression. Never returns a nullable type unless the
 * type itself is one — the caller appends `?` from the field's own `optional`/`nullable` flags.
 *
 * @param forInput - When true, a reference to a model or hoisted shape with an Input variant
 *   renders as `<Name>Input`.
 * @throws {Error} Via the scalar renderer, if a scalar has no Kotlin mapping.
 */
export function renderKotlinType(type: ContractTypeNode, ctx: RenderContext, forInput = false): string {
    const decl = ctx.hoisted?.byNode.get(type);
    if (decl) {
        const name = hoistedTypeName(decl, forInput);
        registerModelImport(name, ctx);
        return name;
    }

    switch (type.kind) {
        case 'scalar':
            return renderScalar(type.name, ctx);
        case 'literal':
            return literalKotlinType(type.value);
        case 'array':
            return `List<${renderKotlinType(type.item, ctx, forInput)}>`;
        case 'record': {
            const key = renderKotlinType(type.key, ctx, forInput);
            const value = renderKotlinType(type.value, ctx, forInput);
            if (key !== 'String') {
                ctx.warn?.(
                    `A record key of type '${key}' is not representable as a JSON object key; emitting Map<String, ${value}>. ` +
                        `Parse the key yourself, or declare the key as a string.`,
                );
            }
            return `Map<String, ${value}>`;
        }
        case 'tuple':
            return renderTuple(type.items, ctx, forInput);
        case 'ref': {
            const name = forInput && ctx.modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
            registerModelImport(name, ctx);
            return name;
        }
        case 'lazy':
            return renderKotlinType(type.inner, ctx, forInput);
        case 'union': {
            // A union with at most one non-null member never gets a sealed interface: it is either
            // Kotlin's own nullable type or nothing at all.
            const nonNull = type.members.filter(m => !isNullScalar(m));
            const nullable = nonNull.length !== type.members.length;
            if (nonNull.length === 0) return 'Nothing?';
            if (nonNull.length === 1) {
                const inner = renderKotlinType(nonNull[0]!, ctx, forInput);
                return nullable && !inner.endsWith('?') ? `${inner}?` : inner;
            }
            ctx.imports.add('kotlinx.serialization.json.JsonElement');
            return 'JsonElement';
        }
        case 'enum':
        case 'inlineObject':
        case 'intersection':
        case 'discriminatedUnion':
            // Reached only when the shape could not be given a name — a discriminated union whose
            // tag is not statically known, or a caller that skipped the hoisting pass.
            ctx.imports.add('kotlinx.serialization.json.JsonElement');
            return 'JsonElement';
    }
}

function hoistedTypeName(decl: HoistedDecl, forInput: boolean): string {
    const name = forInput && decl.needsInput ? `${decl.name}Input` : decl.name;
    return decl.nullable ? `${name}?` : name;
}

/** Import a model into a file that is not itself in the models package. */
function registerModelImport(typeName: string, ctx: RenderContext): void {
    if (!ctx.modelsPackage) return;
    ctx.imports.add(`${ctx.modelsPackage}.${typeName.replace(/\?$/, '')}`);
}

function isNullScalar(type: ContractTypeNode): boolean {
    return type.kind === 'scalar' && type.name === 'null';
}

/**
 * A 2- or 3-tuple maps onto Kotlin's own `Pair`/`Triple`, serialized as a JSON array by a runtime
 * serializer the field carries as an annotation. Any other arity becomes a hoisted class, because a
 * property-level `@Serializable(with = ...)` applies to the property's own type and so cannot reach
 * a tuple nested inside a collection.
 */
function renderTuple(items: ContractTypeNode[], ctx: RenderContext, forInput: boolean): string {
    if (items.length === 2 || items.length === 3) {
        const rendered = items.map(t => renderKotlinType(t, ctx, forInput));
        return items.length === 2 ? `Pair<${rendered.join(', ')}>` : `Triple<${rendered.join(', ')}>`;
    }
    ctx.imports.add('kotlinx.serialization.json.JsonArray');
    return 'JsonArray';
}

/**
 * The `@Serializable(with = ...)` annotation a field needs for its own type, or `undefined`.
 * Only `Pair`/`Triple` need one: kotlinx would otherwise write `{"first":…,"second":…}` rather than
 * the JSON array a contract tuple travels as.
 */
function typeSerializerAnnotation(type: ContractTypeNode, ctx: RenderContext): string | undefined {
    const inner = type.kind === 'lazy' ? type.inner : type;
    if (inner.kind !== 'tuple' || ctx.hoisted?.byNode.has(inner)) return undefined;
    if (inner.items.length === 2) {
        ctx.imports.add(`${ctx.packageName}.runtime.PairAsArraySerializer`);
        ctx.imports.add('kotlinx.serialization.Serializable');
        return '@Serializable(with = PairAsArraySerializer::class)';
    }
    if (inner.items.length === 3) {
        ctx.imports.add(`${ctx.packageName}.runtime.TripleAsArraySerializer`);
        ctx.imports.add('kotlinx.serialization.Serializable');
        return '@Serializable(with = TripleAsArraySerializer::class)';
    }
    return undefined;
}

/**
 * Map a ContractKit scalar to its Kotlin Multiplatform type, registering the import it needs.
 *
 * @throws {Error} When a scalar has no mapping, so a scalar added to core fails the build here
 *   rather than emitting Kotlin that does not compile.
 */
export function renderScalar(name: ScalarTypeNode['name'], ctx: RenderContext): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'interval':
            return 'String';
        case 'number':
            return 'Double';
        // `int` is a JS safe integer in the source language, which overflows Kotlin's 32-bit Int.
        case 'int':
            return 'Long';
        case 'bigint':
            ctx.imports.add(`${ctx.packageName}.runtime.BigInt`);
            return 'BigInt';
        case 'decimal':
            ctx.imports.add(`${ctx.packageName}.runtime.Decimal`);
            return 'Decimal';
        case 'boolean':
            return 'Boolean';
        case 'date':
            ctx.imports.add('kotlinx.datetime.LocalDate');
            return 'LocalDate';
        case 'time':
            ctx.imports.add('kotlinx.datetime.LocalTime');
            return 'LocalTime';
        case 'datetime':
            ctx.imports.add('kotlin.time.Instant');
            return 'Instant';
        case 'duration':
            ctx.imports.add('kotlin.time.Duration');
            return 'Duration';
        case 'uuid':
            ctx.imports.addOptIn('ExperimentalUuidApi', 'kotlin.uuid.ExperimentalUuidApi');
            ctx.imports.add('kotlin.uuid.Uuid');
            return 'Uuid';
        case 'binary':
            return 'ByteArray';
        case 'null':
            return 'Nothing?';
        case 'unknown':
        case 'json':
        case 'object':
            ctx.imports.add('kotlinx.serialization.json.JsonElement');
            return 'JsonElement';
        default: {
            const _exhaustive: never = name;
            throw new Error(`plugin-kotlin: unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

function literalKotlinType(value: string | number | boolean): string {
    if (typeof value === 'string') return 'String';
    if (typeof value === 'boolean') return 'Boolean';
    return Number.isInteger(value) ? 'Long' : 'Double';
}

// ─── Serializer expressions ────────────────────────────────────────────────

/**
 * A Kotlin expression for the `KSerializer` of `type`, used by the generated union serializers.
 * Unions dispatch by trying members in order, so each member needs its serializer named explicitly
 * rather than resolved from a reified type parameter.
 */
function serializerExpression(type: ContractTypeNode, ctx: RenderContext, forInput: boolean): string {
    const decl = ctx.hoisted?.byNode.get(type);
    if (decl) return `${forInput && decl.needsInput ? `${decl.name}Input` : decl.name}.serializer()`;

    switch (type.kind) {
        case 'lazy':
            return serializerExpression(type.inner, ctx, forInput);
        case 'ref':
            return `${renderKotlinType(type, ctx, forInput)}.serializer()`;
        case 'array':
            ctx.imports.add('kotlinx.serialization.builtins.ListSerializer');
            return `ListSerializer(${serializerExpression(type.item, ctx, forInput)})`;
        case 'record':
            ctx.imports.add('kotlinx.serialization.builtins.MapSerializer');
            ctx.imports.add('kotlinx.serialization.builtins.serializer');
            return `MapSerializer(String.serializer(), ${serializerExpression(type.value, ctx, forInput)})`;
        case 'tuple': {
            const inner = type.items.map(t => serializerExpression(t, ctx, forInput)).join(', ');
            if (type.items.length === 2) {
                ctx.imports.add(`${ctx.packageName}.runtime.PairAsArraySerializer`);
                return `PairAsArraySerializer(${inner})`;
            }
            ctx.imports.add(`${ctx.packageName}.runtime.TripleAsArraySerializer`);
            return `TripleAsArraySerializer(${inner})`;
        }
        case 'literal':
        case 'scalar':
        default: {
            const kotlinType = renderKotlinType(type, ctx, forInput);
            if (kotlinType === 'ByteArray') {
                ctx.imports.add('kotlinx.serialization.builtins.ByteArraySerializer');
                return 'ByteArraySerializer()';
            }
            if (['String', 'Long', 'Double', 'Boolean'].includes(kotlinType)) {
                ctx.imports.add('kotlinx.serialization.builtins.serializer');
            }
            return `${kotlinType}.serializer()`;
        }
    }
}

// ─── Default values ────────────────────────────────────────────────────────

/**
 * Render a contract default as a Kotlin expression of the field's own type. Returns `undefined`
 * when the value cannot be expressed, so the field is emitted without an initializer rather than
 * with one that will not compile.
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
                    return Number.isInteger(value) ? `${value}.0` : String(value);
                case 'decimal':
                    ctx.imports.add(`${ctx.packageName}.runtime.Decimal`);
                    return `Decimal("${value}")`;
                case 'bigint':
                    ctx.imports.add(`${ctx.packageName}.runtime.BigInt`);
                    return `BigInt("${value}")`;
            }
        }
        return Number.isInteger(value) ? `${value}L` : String(value);
    }

    // A string default against an enum names one of its members. When the enum was hoisted into a
    // real Kotlin enum class, that is expressible; a bare inline enum has no class to qualify.
    if (inner.kind === 'enum') {
        const decl = ctx.hoisted?.byNode.get(inner);
        if (!decl || !inner.values.includes(value)) return undefined;
        return `${decl.name}.${enumEntryNames(inner.values).get(value)}`;
    }

    // The same default written against a NAMED enum contract — `rating: Rating = "neutral"`,
    // where `contract Rating: enum(...)` — arrives here as a ref rather than as the enum node,
    // and used to fall all the way through to the string branch at the end. That emitted
    // `val rating: Rating? = "neutral"`, which does not compile: the field's type is the enum
    // class and the initializer was its wire spelling.
    if (inner.kind === 'ref') {
        const target = ctx.modelIndex.get(inner.name);
        const targetType = target?.type?.kind === 'lazy' ? target.type.inner : target?.type;
        if (targetType?.kind !== 'enum' || !targetType.values.includes(value)) return undefined;
        return `${inner.name}.${enumEntryNames(targetType.values).get(value)}`;
    }
    if (inner.kind === 'scalar') {
        switch (inner.name) {
            case 'decimal':
                ctx.imports.add(`${ctx.packageName}.runtime.Decimal`);
                return `Decimal(${quoteKotlinString(value)})`;
            case 'bigint':
                ctx.imports.add(`${ctx.packageName}.runtime.BigInt`);
                return `BigInt(${quoteKotlinString(value)})`;
            case 'string':
            case 'email':
            case 'url':
            case 'interval':
                return quoteKotlinString(value);
            default:
                // date/uuid/datetime and friends have no literal syntax; leave the field required.
                return undefined;
        }
    }
    return quoteKotlinString(value);
}

/** Quote a string as a Kotlin literal. `$` starts a template expression, so it is escaped too. */
export function quoteKotlinString(value: string): string {
    const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `"${escaped}"`;
}

// ─── Model generation ──────────────────────────────────────────────────────

function generateModel(model: ModelNode, ctx: RenderContext): string[] {
    if (model.type) return generateAliasModel(model, ctx);

    const effective = effectiveFieldsFor(model, ctx);
    const needsSplit = ctx.modelsWithInput.has(model.name) || effective.some(f => f.visibility !== 'normal');

    if (!needsSplit) return generateDataClass(model.name, effective, ctx, false, model);

    const readFields = effective.filter(f => f.visibility !== 'writeonly');
    const inputFields = effective.filter(f => f.visibility !== 'readonly');
    return [
        ...generateDataClass(model.name, readFields, ctx, false, model),
        '',
        ...generateDataClass(`${model.name}Input`, inputFields, ctx, true, model),
    ];
}

/**
 * Bases are flattened rather than expressed as Kotlin inheritance: a `data class` cannot extend
 * another `data class`, and the language's own composition (an interface per base) would not give
 * the subclass the base's constructor properties. `resolveEffectiveFields` applies the same
 * later-wins override rule the inheritance validator enforces.
 */
function effectiveFieldsFor(model: ModelNode, ctx: RenderContext): FieldNode[] {
    if (!model.bases || model.bases.length === 0) return model.fields;
    const { fields, unresolved } = resolveEffectiveFields(model.name, ctx.modelIndex);
    for (const name of unresolved) {
        ctx.warn?.(`Contract '${model.name}' extends '${name}', which is not defined; its fields are missing from the generated class.`);
    }
    return fields;
}

function generateAliasModel(model: ModelNode, ctx: RenderContext): string[] {
    const type = model.type!;
    const inner = type.kind === 'lazy' ? type.inner : type;

    // A union alias is emitted by the hoisting pass, which owns the sealed interface named after it.
    if (ctx.hoisted?.byNode.has(inner)) return [];

    if (inner.kind === 'enum') return generateEnumClass(model.name, inner.values, ctx, model.description, model.deprecated);

    // An intersection or inline object at model level names a real shape, so it becomes a class
    // rather than an alias to an opaque JSON object.
    if (inner.kind === 'intersection' || inner.kind === 'inlineObject') {
        const { fields, unresolved } = resolveEffectiveFields(inner, ctx.modelIndex);
        for (const name of unresolved) {
            ctx.warn?.(`Contract '${model.name}' references '${name}', which is not defined; its fields are missing from the generated class.`);
        }
        const needsSplit = ctx.modelsWithInput.has(model.name) || fields.some(f => f.visibility !== 'normal');
        if (!needsSplit) return generateDataClass(model.name, fields, ctx, false, model);
        return [
            ...generateDataClass(
                model.name,
                fields.filter(f => f.visibility !== 'writeonly'),
                ctx,
                false,
                model,
            ),
            '',
            ...generateDataClass(
                `${model.name}Input`,
                fields.filter(f => f.visibility !== 'readonly'),
                ctx,
                true,
                model,
            ),
        ];
    }

    const lines: string[] = [];
    lines.push(...docLines(model.description, model.deprecated, ''));
    lines.push(`typealias ${model.name} = ${renderKotlinType(type, ctx, false)}`);
    if (ctx.modelsWithInput.has(model.name)) {
        lines.push(`typealias ${model.name}Input = ${renderKotlinType(type, ctx, true)}`);
    }
    return lines;
}

function enumEntryNames(values: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const used = new Set<string>();
    for (const value of values) out.set(value, uniqueName(toKotlinEnumEntryName(value), used));
    return out;
}

function generateEnumClass(name: string, values: string[], ctx: RenderContext, description?: string, deprecated?: boolean): string[] {
    ctx.imports.add('kotlinx.serialization.SerialName');
    ctx.imports.add('kotlinx.serialization.Serializable');

    const entries = enumEntryNames(values);
    const lines: string[] = [];
    lines.push(...docLines(description, deprecated, ''));
    lines.push('@Serializable');
    lines.push(`enum class ${name} {`);
    for (const value of values) {
        lines.push(`    @SerialName(${quoteKotlinString(value)})`);
        lines.push(`    ${entries.get(value)},`);
    }
    lines.push('}');
    // An enum has no fields, so no visibility can differ between reading and writing it.
    if (ctx.modelsWithInput.has(name)) lines.push(`typealias ${name}Input = ${name}`);
    return lines;
}

/** The sealed interfaces a generated class has to declare it implements. */
function supertypesFor(readName: string, ctx: RenderContext, forInput: boolean): string[] {
    const unions = ctx.hoisted?.memberships.get(readName) ?? [];
    return unions.map(union => {
        const decl = ctx.hoisted?.byName.get(union);
        return forInput && decl?.needsInput ? `${union}Input` : union;
    });
}

function generateDataClass(name: string, fields: FieldNode[], ctx: RenderContext, forInput: boolean, model: ModelNode): string[] {
    const readName = forInput && name.endsWith('Input') ? name.slice(0, -'Input'.length) : name;
    return renderDataClass(name, fields, ctx, forInput, supertypesFor(readName, ctx, forInput), model.description, model.deprecated);
}

function renderDataClass(
    name: string,
    fields: FieldNode[],
    ctx: RenderContext,
    forInput: boolean,
    supertypes: string[],
    description?: string,
    deprecated?: boolean,
    serializerName?: string,
): string[] {
    ctx.imports.add('kotlinx.serialization.Serializable');

    const lines: string[] = [];
    lines.push(...docLines(description, deprecated, ''));
    lines.push(serializerName ? `@Serializable(with = ${serializerName}::class)` : '@Serializable');
    const implementsClause = supertypes.length > 0 ? ` : ${supertypes.join(', ')}` : '';

    // A `data class` needs at least one constructor property; a contract with no visible fields
    // still has to produce a serializable type.
    if (fields.length === 0) {
        lines.push(`class ${name}${implementsClause}`);
        return lines;
    }

    lines.push(`data class ${name}(`);
    for (const field of fields) lines.push(...renderField(field, ctx, forInput));
    lines.push(`)${implementsClause}`);
    return lines;
}

function renderField(field: FieldNode, ctx: RenderContext, forInput: boolean): string[] {
    const lines: string[] = [];
    const propName = toKotlinPropertyName(field.name);
    const wireName = propName.replace(/`/g, '');

    let typeStr = renderKotlinType(field.type, ctx, forInput);
    const explicitDefault = field.default !== undefined ? renderDefault(field.default, field.type, ctx) : undefined;
    const isOptional = field.optional || explicitDefault !== undefined;
    if ((field.nullable || isOptional) && !typeStr.endsWith('?')) typeStr += '?';

    let initializer: string | undefined = explicitDefault;
    if (initializer === undefined && field.optional) initializer = 'null';
    // A `literal()` field carries exactly one value, so it defaults to it rather than being asked
    // for at every call site. `encodeDefaults` in the runtime Json is what puts it on the wire.
    if (initializer === undefined && !field.optional && !field.nullable) {
        const inner = field.type.kind === 'lazy' ? field.type.inner : field.type;
        if (inner.kind === 'literal') {
            initializer = typeof inner.value === 'string' ? quoteKotlinString(inner.value) : renderDefault(inner.value, inner, ctx);
        }
    }

    lines.push(...docLines(field.description, field.deprecated, '    '));
    const annotations: string[] = [];
    const serializerAnnotation = typeSerializerAnnotation(field.type, ctx);
    if (serializerAnnotation) annotations.push(serializerAnnotation);
    if (wireName !== field.name) {
        ctx.imports.add('kotlinx.serialization.SerialName');
        annotations.push(`@SerialName(${quoteKotlinString(field.name)})`);
    }

    const prefix = annotations.length > 0 ? `${annotations.join(' ')} ` : '';
    const suffix = initializer !== undefined ? ` = ${initializer}` : '';
    lines.push(`    ${prefix}val ${propName}: ${typeStr}${suffix},`);
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
            return generateEnumClass(name, decl.values ?? [], ctx, decl.description);
        case 'dataClass':
            return renderDataClass(
                name,
                (decl.fields ?? []).filter(f => (forInput ? f.visibility !== 'readonly' : f.visibility !== 'writeonly')),
                ctx,
                forInput,
                supertypesFor(decl.name, ctx, forInput),
                decl.description,
            );
        case 'tuple':
            return generateTupleClass(decl, name, ctx, forInput);
        case 'plainUnion':
            return generatePlainUnion(decl, name, ctx, forInput);
        case 'discriminatedUnion':
            return generateDiscriminatedUnion(decl, name, ctx, forInput);
    }
}

/** Shared preamble every generated serializer needs. */
function addSerializerImports(ctx: RenderContext): void {
    ctx.imports.add('kotlinx.serialization.KSerializer');
    ctx.imports.add('kotlinx.serialization.SerializationException');
    ctx.imports.add('kotlinx.serialization.Serializable');
    ctx.imports.add('kotlinx.serialization.descriptors.SerialDescriptor');
    ctx.imports.add('kotlinx.serialization.descriptors.buildClassSerialDescriptor');
    ctx.imports.add('kotlinx.serialization.encoding.Decoder');
    ctx.imports.add('kotlinx.serialization.encoding.Encoder');
    ctx.imports.add('kotlinx.serialization.json.JsonDecoder');
    ctx.imports.add('kotlinx.serialization.json.JsonEncoder');
    ctx.imports.add('kotlinx.serialization.json.decodeFromJsonElement');
    ctx.imports.add('kotlinx.serialization.json.encodeToJsonElement');
}

/**
 * A contract tuple of an arity Kotlin has no built-in type for. It travels as a JSON array, so the
 * class carries a generated serializer rather than the field-level annotation `Pair` and `Triple`
 * use.
 */
function generateTupleClass(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    addSerializerImports(ctx);
    ctx.imports.add('kotlinx.serialization.json.JsonArray');

    const items = decl.items ?? [];
    const serializerName = `${name}Serializer`;
    const fields: string[] = items.map((item, i) => `    val item${i}: ${renderKotlinType(item, ctx, forInput)},`);

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`@Serializable(with = ${serializerName}::class)`);
    lines.push(`data class ${name}(`);
    lines.push(...fields);
    lines.push(')');
    lines.push('');
    lines.push(`object ${serializerName} : KSerializer<${name}> {`);
    lines.push(`    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("${name}")`);
    lines.push('');
    lines.push(`    override fun serialize(encoder: Encoder, value: ${name}) {`);
    lines.push(`        val output = encoder as? JsonEncoder ?: throw SerializationException("${name} can only be encoded as JSON")`);
    lines.push('        output.encodeJsonElement(');
    lines.push('            JsonArray(');
    lines.push('                listOf(');
    items.forEach((item, i) => {
        lines.push(`                    output.json.encodeToJsonElement(${serializerExpression(item, ctx, forInput)}, value.item${i}),`);
    });
    lines.push('                ),');
    lines.push('            ),');
    lines.push('        )');
    lines.push('    }');
    lines.push('');
    lines.push(`    override fun deserialize(decoder: Decoder): ${name} {`);
    lines.push(`        val input = decoder as? JsonDecoder ?: throw SerializationException("${name} can only be decoded from JSON")`);
    lines.push(`        val array = input.decodeJsonElement() as? JsonArray ?: throw SerializationException("Expected a JSON array for ${name}")`);
    lines.push(
        `        if (array.size != ${items.length}) throw SerializationException("Expected ${items.length} elements for ${name}, got \${array.size}")`,
    );
    lines.push(`        return ${name}(`);
    items.forEach((item, i) => {
        lines.push(`            input.json.decodeFromJsonElement(${serializerExpression(item, ctx, forInput)}, array[${i}]),`);
    });
    lines.push('        )');
    lines.push('    }');
    lines.push('}');
    return lines;
}

/**
 * A plain `union(A | B)` becomes a sealed interface with one wrapper case per member, so callers
 * get an exhaustive `when` instead of an untyped JSON value.
 *
 * Decoding tries each member in declaration order and takes the first that parses, which is exactly
 * what Zod's `z.union` does on the server. Anything else would let the client and the service
 * disagree about a payload both of them accept.
 */
function generatePlainUnion(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    addSerializerImports(ctx);
    const serializerName = `${name}Serializer`;
    const members = decl.members ?? [];

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`@Serializable(with = ${serializerName}::class)`);
    lines.push(`sealed interface ${name} {`);
    for (const member of members) {
        const memberType = renderKotlinType(member.type, ctx, forInput);
        lines.push(`    data class ${member.wrapperName}(val value: ${memberType}) : ${name}`);
    }
    lines.push('}');
    lines.push('');
    lines.push(`object ${serializerName} : KSerializer<${name}> {`);
    lines.push(`    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("${name}")`);
    lines.push('');
    lines.push(`    override fun serialize(encoder: Encoder, value: ${name}) {`);
    lines.push(`        val output = encoder as? JsonEncoder ?: throw SerializationException("${name} can only be encoded as JSON")`);
    lines.push('        val element = when (value) {');
    for (const member of members) {
        lines.push(
            `            is ${name}.${member.wrapperName} -> output.json.encodeToJsonElement(${serializerExpression(member.type, ctx, forInput)}, value.value)`,
        );
    }
    lines.push('        }');
    lines.push('        output.encodeJsonElement(element)');
    lines.push('    }');
    lines.push('');
    lines.push(`    override fun deserialize(decoder: Decoder): ${name} {`);
    lines.push(`        val input = decoder as? JsonDecoder ?: throw SerializationException("${name} can only be decoded from JSON")`);
    lines.push('        val element = input.decodeJsonElement()');
    for (const member of members) {
        lines.push(
            `        runCatching { ${name}.${member.wrapperName}(input.json.decodeFromJsonElement(${serializerExpression(member.type, ctx, forInput)}, element)) }` +
                '.getOrNull()?.let { return it }',
        );
    }
    lines.push(`        throw SerializationException("No ${name} member matched the payload")`);
    lines.push('    }');
    lines.push('}');
    return lines;
}

/**
 * A `discriminated(by=tag, A | B)` becomes a sealed interface its member classes implement, with a
 * serializer that dispatches on the tag value.
 *
 * `serialize` writes an explicit `when` rather than delegating to kotlinx's
 * `JsonContentPolymorphicSerializer`, whose subclass lookup falls back to runtime reflection —
 * dependable on the JVM, not on the other Kotlin Multiplatform targets this SDK compiles for.
 */
function generateDiscriminatedUnion(decl: HoistedDecl, name: string, ctx: RenderContext, forInput: boolean): string[] {
    addSerializerImports(ctx);
    ctx.imports.add('kotlinx.serialization.json.contentOrNull');
    ctx.imports.add('kotlinx.serialization.json.jsonObject');
    ctx.imports.add('kotlinx.serialization.json.jsonPrimitive');

    const serializerName = `${name}Serializer`;
    const members = (decl.members ?? []).map(member => ({
        ...member,
        className: memberClassName(member.typeName, ctx, forInput),
    }));
    const discriminator = decl.discriminator ?? '';

    const lines: string[] = [];
    lines.push(...docLines(decl.description, undefined, ''));
    lines.push(`@Serializable(with = ${serializerName}::class)`);
    lines.push(`sealed interface ${name}`);
    lines.push('');
    lines.push(`object ${serializerName} : KSerializer<${name}> {`);
    lines.push(`    override val descriptor: SerialDescriptor = buildClassSerialDescriptor("${name}")`);
    lines.push('');
    lines.push(`    override fun serialize(encoder: Encoder, value: ${name}) {`);
    lines.push(`        val output = encoder as? JsonEncoder ?: throw SerializationException("${name} can only be encoded as JSON")`);
    lines.push('        val element = when (value) {');
    for (const member of members) {
        lines.push(`            is ${member.className} -> output.json.encodeToJsonElement(${member.className}.serializer(), value)`);
    }
    lines.push('        }');
    lines.push('        output.encodeJsonElement(element)');
    lines.push('    }');
    lines.push('');
    lines.push(`    override fun deserialize(decoder: Decoder): ${name} {`);
    lines.push(`        val input = decoder as? JsonDecoder ?: throw SerializationException("${name} can only be decoded from JSON")`);
    lines.push('        val element = input.decodeJsonElement()');
    lines.push(`        return when (val tag = element.jsonObject[${quoteKotlinString(discriminator)}]?.jsonPrimitive?.contentOrNull) {`);
    for (const member of members) {
        lines.push(
            `            ${quoteKotlinString(member.tag ?? '')} -> input.json.decodeFromJsonElement(${member.className}.serializer(), element)`,
        );
    }
    lines.push(`            else -> throw SerializationException("Unknown ${name} ${discriminator}: $tag")`);
    lines.push('        }');
    lines.push('    }');
    lines.push('}');
    return lines;
}

/** The concrete class name of a union member, in the read or input variant. */
function memberClassName(typeName: string, ctx: RenderContext, forInput: boolean): string {
    if (!forInput) return typeName;
    const decl = ctx.hoisted?.byName.get(typeName);
    if (decl) return decl.needsInput ? `${typeName}Input` : typeName;
    return ctx.modelsWithInput.has(typeName) ? `${typeName}Input` : typeName;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

/**
 * KDoc for a declaration, with a `@deprecated` tag rather than the `@Deprecated` annotation for
 * fields: an annotated property makes a data class's own generated `copy` and `toString` warn.
 */
function docLines(description: string | undefined, deprecated: boolean | undefined, indent: string): string[] {
    const parts: string[] = [];
    if (description) parts.push(description);
    if (deprecated) parts.push('@deprecated');
    if (parts.length === 0) return [];
    return kdocLines(parts.join('\n'), indent);
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
