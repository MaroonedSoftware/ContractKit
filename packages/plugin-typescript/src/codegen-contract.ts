import { relative, dirname } from 'node:path';
import type {
    ContractRootNode,
    ModelNode,
    FieldNode,
    ContractTypeNode,
    ScalarTypeNode,
    ArrayTypeNode,
    TupleTypeNode,
    RecordTypeNode,
    EnumTypeNode,
    LiteralTypeNode,
    UnionTypeNode,
    DiscriminatedUnionTypeNode,
    InlineObjectTypeNode,
    IntersectionTypeNode,
    ObjectMode,
} from '@contractkit/core';
import {
    collectTypeRefs,
    computeModelsWithOutput as ckComputeModelsWithOutput,
    collectExternalOutputRefs as ckCollectExternalOutputRefs,
    resolveEffectiveFields,
} from '@contractkit/core';
import { escapeJsDocLines, escapeSingleQuoted, sourceLink } from './ts-render.js';
import { collectExternalWireInputRefs, flattenFormatChain, renamingCase, renderWireInputModel } from './codegen-wire-input.js';
import type { WireInputRenderContext } from './codegen-wire-input.js';
import type { TsRenderTarget } from './ts-render.js';
import { DECIMAL_IMPORT, DECIMAL_PRELUDE_LINES } from './decimal-runtime.js';
import { renderReviveFunctions, reviveFnName, coerceDeclsFor } from './codegen-revive.js';

/**
 * Maps a ContractKit object mode to its Zod constructor name.
 *
 * @returns `"z.strictObject"` | `"z.object"` | `"z.looseObject"`
 */
export function modeToWrapper(mode: ObjectMode): string {
    switch (mode) {
        case 'strict':
            return 'z.strictObject';
        case 'strip':
            return 'z.object';
        case 'loose':
            return 'z.looseObject';
    }
}

// ─── Cross-file import resolution ─────────────────────────────────────────

/** Cross-file context passed to `generateContract` to wire up imports and Input/Output variant tracking. */
export interface ContractCodegenContext {
    /** Map from model name → absolute output file path */
    modelOutPaths: Map<string, string>;
    /** Absolute output file path for the current contract file */
    currentOutPath: string;
    /** Set of model names that have Input variants (models with visibility modifiers) */
    modelsWithInput?: Set<string>;
    /** Set of model names that have Output variants (models with format(output=...)) */
    modelsWithOutput?: Set<string>;
    /**
     * Models that get an `XWireInput` type, the shape a request sends (see `codegen-wire-input`).
     * Set for SDK type files only: a server parses requests through the schema itself.
     */
    modelsWithWireInput?: Set<string>;
    /** If set, import JsonValue from this path instead of re-declaring it (avoids barrel re-export conflicts) */
    jsonValueImportPath?: string;
    /**
     * Every model across all contract files. A `format()` contract is flattened rather than
     * extended (see `flattenFormatChain`), so its bases' fields are needed even when a base lives
     * in another file. Without it, only this file's models can be flattened.
     */
    modelMap?: Map<string, ModelNode>;
    /**
     * Runtime the emitted types describe. Only affects scalars whose TypeScript type differs per
     * runtime: `binary` is a `Buffer` on a Node server and a `Blob` in a fetch client, and
     * `_ZodBinary` is generated to match. Default `'client'`.
     */
    target?: TsRenderTarget;
    /** Model names that carry a `decimal`, directly or transitively. */
    modelsWithDecimal?: Set<string>;
    /**
     * Emit `reviveX()` hydration functions alongside the schemas. Set only for SDK type files: a
     * server handler receives decimals already parsed by `_ZodDecimal`, so it has nothing to revive.
     */
    emitRevivers?: boolean;
}

// ─── Public entry point ────────────────────────────────────────────────────

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

    // Transitive closure: add models that reference models with Input variants,
    // including through base model inheritance.
    let changed = true;
    while (changed) {
        changed = false;
        for (const model of models) {
            if (result.has(model.name)) continue;
            const refs = new Set<string>();
            for (const field of model.fields) {
                collectTypeRefs(field.type, refs);
            }
            // A model that extends a parent with Input variants also needs an Input variant,
            // so that the write schema can extend ParentInput instead of Parent.
            if (model.bases) for (const b of model.bases) refs.add(b);
            // A type alias (model.type set) that references a model with Input variants
            // also needs an Input variant.
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

function generateComments(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push('/**');
    if (model.deprecated) {
        lines.push(` * @deprecated`);
    }
    if (model.description) {
        for (const l of escapeJsDocLines(model.description)) lines.push(` * ${l}`);
    }

    lines.push(` * generated from ${sourceLink(model.name, outPath, model.loc.file, model.loc.line)}`);
    lines.push('*/');
    return lines;
}

/**
 * Generate a TypeScript module containing Zod schemas for every model in `root`.
 *
 * Emits two schemas per model when visibility modifiers are present: `Model` (read — no
 * writeonly fields) and `ModelInput` (write — no readonly fields). Writeonly inheritance rides
 * on the Input chain, since a child's `Input` extends its parent's `Input`, which already carries
 * the parent's writeonly fields.
 *
 * @param root - The parsed contract root node.
 * @param context - Optional cross-file context for import resolution and Input/Output variant tracking.
 * @returns The full TypeScript source as a string.
 */
export function generateContract(root: ContractRootNode, context?: ContractCodegenContext): string {
    const modelMap = contractModelMap(root, context);
    // What the file actually declares: a flattened `format()` contract carries its bases' fields and
    // no longer names the bases, so scalars and imports are decided from these, not from `root`.
    const effectiveRoot = { ...root, models: root.models.map(m => (m.type ? m : flattenFormatChain(m, modelMap))) };
    const needsDateTime = rootNeedsDateTime(effectiveRoot);
    const needsDuration = rootNeedsScalar(effectiveRoot, 'duration');
    const needsInterval = rootNeedsScalar(effectiveRoot, 'interval');
    const needsBinary = rootNeedsScalar(effectiveRoot, 'binary');
    const needsDatetime = rootNeedsScalar(effectiveRoot, 'datetime');
    const needsJson = rootNeedsScalar(effectiveRoot, 'json');
    const needsDecimal = rootNeedsScalar(effectiveRoot, 'decimal');
    const externalRefs = collectExternalRefs(effectiveRoot);
    const lines: string[] = [];

    // Compute which models have Input variants (local, incl. transitive deps + external)
    const externalModelsWithInput = context?.modelsWithInput ?? new Set<string>();
    const localModelsWithInput = computeModelsWithInput(root.models, externalModelsWithInput);
    const allModelsWithInput = new Set([...localModelsWithInput, ...externalModelsWithInput]);

    // Compute which models have Output variants (post-transform wire shape)
    const externalModelsWithOutput = context?.modelsWithOutput ?? new Set<string>();
    const localModelsWithOutput = ckComputeModelsWithOutput(root.models, externalModelsWithOutput);
    const allModelsWithOutput = new Set([...localModelsWithOutput, ...externalModelsWithOutput]);

    const wireCtx: WireInputRenderContext | undefined = context?.modelsWithWireInput
        ? {
              modelsWithInput: allModelsWithInput,
              modelsWithWireInput: context.modelsWithWireInput,
              modelMap,
              target: context.target ?? 'client',
              jsonType: '_JsonValue',
          }
        : undefined;

    // Collect additional external Input refs needed for Input schema fields
    const externalInputRefs = allModelsWithInput.size > 0 ? collectExternalInputRefs(effectiveRoot, allModelsWithInput) : [];
    const externalOutputRefs = allModelsWithOutput.size > 0 ? ckCollectExternalOutputRefs(effectiveRoot, allModelsWithOutput) : [];
    const externalWireInputRefs = wireCtx ? collectExternalWireInputRefs(root, wireCtx) : [];
    const allExternalRefs = [...new Set([...externalRefs, ...externalInputRefs, ...externalOutputRefs, ...externalWireInputRefs])].sort();

    lines.push(`import { z } from 'zod';`);
    const luxonImports: string[] = [];
    if (needsDateTime) luxonImports.push('DateTime');
    if (needsDuration) luxonImports.push('Duration');
    if (needsInterval) luxonImports.push('Interval');
    if (luxonImports.length > 0) lines.push(`import { ${luxonImports.join(', ')} } from 'luxon';`);
    if (needsDecimal) lines.push(DECIMAL_IMPORT);
    for (const ref of allExternalRefs) {
        const importPath = resolveImportPath(ref, context);
        // A cross-file model that carries a decimal contributes its reviver too — the local
        // reviver calls it rather than re-deriving the other file's shape.
        const names =
            context?.emitRevivers && context.modelsWithDecimal?.has(ref) ? `${ref}, ${reviveFnName(ref)}` : ref;
        lines.push(`import { ${names} } from '${importPath}';`);
    }
    lines.push('');
    if (needsBinary) {
        // The one scalar with no single correct runtime type, so it follows `target` here exactly
        // as `renderTsScalar` does. An SDK type file reaching this through the shared
        // `generateContract` used to emit `Buffer.isBuffer` into a browser client, whose scaffold
        // declares no `@types/node` — the type did not resolve and the check could not run.
        lines.push(
            context?.target === 'server'
                ? `const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });`
                : `const _ZodBinary = z.custom<Blob>((val) => val instanceof Blob, { error: 'Must be binary data' });`,
        );
    }
    if (needsDatetime) {
        lines.push(
            `const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));`,
        );
    }
    if (needsInterval) {
        lines.push(
            `const _ZodInterval = z.preprocess((val) => typeof val === 'string' ? Interval.fromISO(val) : val, z.custom<Interval>((val) => val instanceof Interval && val.isValid, { message: 'Must be an ISO 8601 interval' })).transform(val => val.toISO()!);`,
        );
    }
    if (needsDecimal) {
        lines.push(...DECIMAL_PRELUDE_LINES);
    }
    if (needsJson) {
        lines.push(`type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };`);
        lines.push(
            `const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));`,
        );
    }
    if (needsBinary || needsDatetime || needsInterval || needsDecimal || needsJson) lines.push('');

    const reviveOpts =
        context?.emitRevivers && context.modelsWithDecimal
            ? { modelsWithDecimal: context.modelsWithDecimal, modelsWithOutput: allModelsWithOutput, modelMap }
            : undefined;

    const bodyLines: string[] = [];
    // Sorted on the effective models: a flattened contract depends on its inherited fields' types,
    // which may be declared in this file even when the base that brought them is not.
    const rawByName = new Map(root.models.map(m => [m.name, m]));
    for (const model of topoSortModels(effectiveRoot.models).map(m => rawByName.get(m.name)!)) {
        bodyLines.push(...generateModel(model, context?.currentOutPath, allModelsWithInput, modelMap, allModelsWithOutput));
        if (wireCtx?.modelsWithWireInput.has(model.name)) {
            bodyLines.push('');
            bodyLines.push(...renderWireInputModel(model, wireCtx));
        }
        if (reviveOpts) {
            const revivers = renderReviveFunctions(model, reviveOpts);
            if (revivers.length > 0) {
                bodyLines.push('');
                bodyLines.push(...revivers);
            }
        }
        bodyLines.push('');
    }

    // Decided from the emitted revivers rather than from a predicate over the AST, so the
    // declarations and their uses cannot drift apart and leave an unused local behind.
    const coerceDecls = coerceDeclsFor(bodyLines);
    if (coerceDecls.length > 0) {
        lines.push(...coerceDecls);
        lines.push('');
    }
    lines.push(...bodyLines);

    return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(
    model: ModelNode,
    outPath?: string,
    modelsWithInput?: Set<string>,
    modelMap?: Map<string, ModelNode>,
    modelsWithOutput?: Set<string>,
): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, outPath, modelsWithInput, modelsWithOutput);
    }

    const effective = modelMap ? flattenFormatChain(model, modelMap) : model;

    // A model needs Input/read split if it has visibility-modified fields OR if it
    // transitively references models that have Input variants (captured in modelsWithInput).
    const needsInputSplit = effective.fields.some(f => f.visibility !== 'normal') || (modelsWithInput?.has(effective.name) ?? false);

    const lines = needsInputSplit
        ? generateThreeSchemaModel(effective, outPath, modelsWithInput, modelMap)
        : generateSimpleModel(effective, outPath);

    // Emit Output type alias when this model (transitively) has format(output=...)
    if (modelsWithOutput?.has(effective.name)) {
        lines.push(`export type ${effective.name}Output = z.output<typeof ${effective.name}>;`);
    }

    return lines;
}

function generateTypeAlias(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>, modelsWithOutput?: Set<string>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export const ${model.name} = ${renderType(model.type!)};`);
    lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
    if (modelsWithInput?.has(model.name)) {
        lines.push(`export const ${model.name}Input = ${renderInputType(model.type!, modelsWithInput)};`);
        lines.push(`export type ${model.name}Input = z.infer<typeof ${model.name}Input>;`);
    }
    if (modelsWithOutput?.has(model.name)) {
        lines.push(`export type ${model.name}Output = z.output<typeof ${model.name}>;`);
    }
    return lines;
}

function generateSimpleModel(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const wrapper = modeToWrapper(model.mode ?? 'strict');

    const inputCase = renamingCase(model.inputCase);
    const outputCase = renamingCase(model.outputCase);

    if (inputCase || outputCase) {
        const body = inputCase
            ? renderCasedFields(model.fields, inputCase, model.mode, t => renderType(t, inputCase, model.mode))
            : renderFields(model.fields, model.mode);
        lines.push(...renderCasedSchema(model.name, model.fields, wrapper, inputCase, outputCase, body));
        return lines;
    }

    const body = renderFields(model.fields, model.mode);
    const bases = model.bases ?? [];
    if (bases.length > 0) {
        const head = bases[0]!;
        const tail = bases
            .slice(1)
            .map(b => `.extend(${b}.shape)`)
            .join('');
        lines.push(`export const ${model.name} = ${head}${tail}.extend({`);
        lines.push(...body.map(l => `    ${l}`));
        lines.push(`});`);
    } else {
        lines.push(`export const ${model.name} = ${wrapper}({`);
        lines.push(...body.map(l => `    ${l}`));
        lines.push(`});`);
    }

    lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
    return lines;
}

/** Builds a Zod extension chain "Head.extend(B.shape).extend(C.shape)..." for a list of base names,
 * applying a per-base name resolver (e.g. choosing "BaseInput" for bases that have an Input variant). */
function buildExtendChain(bases: string[], resolveName: (b: string) => string): { head: string; tail: string } {
    const head = resolveName(bases[0]!);
    const tail = bases
        .slice(1)
        .map(b => `.extend(${resolveName(b)}.shape)`)
        .join('');
    return { head, tail };
}

function collectEffectiveWritableFieldNames(modelName: string, modelMap: Map<string, ModelNode>): Set<string> {
    const model = modelMap.get(modelName);
    if (!model || model.type) return new Set();
    const result = new Set<string>();
    for (const base of model.bases ?? []) {
        for (const f of collectEffectiveWritableFieldNames(base, modelMap)) result.add(f);
    }
    for (const field of model.fields) {
        if (field.visibility === 'readonly') result.delete(field.name);
        else result.add(field.name);
    }
    return result;
}

function generateThreeSchemaModel(
    model: ModelNode,
    outPath?: string,
    modelsWithInput?: Set<string>,
    modelMap?: Map<string, ModelNode>,
): string[] {
    const lines: string[] = [];
    const name = model.name;

    lines.push(...generateComments(model, outPath));

    const wrapper = modeToWrapper(model.mode ?? 'strict');

    const allFields = model.fields;

    const bases = model.bases ?? [];

    // Read schema — omit writeonly fields; extends parent read schema
    const readFields = allFields.filter(f => f.visibility !== 'writeonly');
    const writeFields = allFields.filter(f => f.visibility !== 'readonly');

    // A format() applies to both halves, the same transform the single-schema path emits: the read
    // schema over the readable fields and the Input schema over the writable ones. Each is a pipe,
    // so neither can be extended, which is why `flattenFormatChain` has already inlined the bases.
    const inputCase = renamingCase(model.inputCase);
    const outputCase = renamingCase(model.outputCase);
    if (inputCase || outputCase) {
        const mode = model.mode;
        const renderWrite = (t: ContractTypeNode) =>
            modelsWithInput ? renderInputType(t, modelsWithInput, mode, inputCase) : renderType(t, inputCase, mode);
        const readBody = inputCase
            ? renderCasedFields(readFields, inputCase, mode, t => renderType(t, inputCase, mode))
            : renderFields(readFields, mode);
        const writeBody = inputCase
            ? renderCasedFields(writeFields, inputCase, mode, renderWrite)
            : modelsWithInput
              ? renderInputFields(writeFields, modelsWithInput, mode)
              : renderFields(writeFields, mode);
        lines.push(...renderCasedSchema(name, readFields, wrapper, inputCase, outputCase, readBody));
        lines.push('');
        lines.push(...renderCasedSchema(`${name}Input`, writeFields, wrapper, inputCase, outputCase, writeBody));
        return lines;
    }

    const readBody = renderFields(readFields, model.mode);
    if (bases.length > 0) {
        const { head, tail } = buildExtendChain(bases, b => b);
        lines.push(`export const ${name} = ${head}${tail}.extend({`);
    } else {
        lines.push(`export const ${name} = ${wrapper}({`);
    }
    lines.push(...readBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}>;`);
    lines.push('');

    // Write schema — omit readonly fields (use Input variants for sub-type refs);
    // extends ParentInput if parent has an Input variant, else extends parent read schema
    const writeBody = modelsWithInput ? renderInputFields(writeFields, modelsWithInput, model.mode) : renderFields(writeFields, model.mode);
    // Fields that become readonly in this model but were writable in a base must be omitted from
    // the base Input schema — Zod's .extend() cannot remove inherited fields.
    const fieldsToOmit = new Set<string>();
    if (bases.length > 0 && modelMap) {
        for (const field of allFields) {
            if (field.visibility === 'readonly') {
                for (const base of bases) {
                    if (collectEffectiveWritableFieldNames(base, modelMap).has(field.name)) {
                        fieldsToOmit.add(field.name);
                        break;
                    }
                }
            }
        }
    }
    const omitClause =
        fieldsToOmit.size > 0
            ? `.omit({ ${[...fieldsToOmit].map(f => `${quoteKey(f)}: true`).join(', ')} })`
            : '';
    if (bases.length > 0) {
        const { head, tail } = buildExtendChain(bases, b => (modelsWithInput?.has(b) ? `${b}Input` : b));
        lines.push(`export const ${name}Input = ${head}${tail}${omitClause}.extend({`);
    } else {
        lines.push(`export const ${name}Input = ${wrapper}({`);
    }
    lines.push(...writeBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push(`export type ${name}Input = z.infer<typeof ${name}Input>;`);

    return lines;
}

// ─── Fields ────────────────────────────────────────────────────────────────

function camelToSnake(s: string): string {
    return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function camelToPascal(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function applyCase(name: string, caseTransform: 'camel' | 'snake' | 'pascal' | undefined): string {
    if (!caseTransform || caseTransform === 'camel') return name;
    if (caseTransform === 'snake') return camelToSnake(name);
    return camelToPascal(name);
}

function renderFields(fields: FieldNode[], defaultMode?: ObjectMode): string[] {
    return fields.flatMap(f => renderField(f, defaultMode));
}

/**
 * A `format(input=)` object's members, keyed in `keyCase`. `renderMember` renders each field's type,
 * which is where a read schema and an Input schema differ: the Input one names `XInput` variants.
 */
function renderCasedFields(
    fields: FieldNode[],
    keyCase: 'snake' | 'pascal',
    defaultMode: ObjectMode | undefined,
    renderMember: (type: ContractTypeNode) => string,
): string[] {
    return fields.map(f => {
        const member = memberType(f.type);
        let expr = renderMember(member.type);
        if (f.default !== undefined) {
            if (f.nullable) expr += '.nullable()';
            const dv = typeof f.default === 'string' ? `"${escapeString(f.default)}"` : String(f.default);
            expr += `.default(${dv})`;
        } else if (f.optional) {
            // .nullish() accepts null or undefined from the API; the transform coerces null → undefined
            expr += '.nullish()';
        } else if (f.nullable) {
            expr += '.nullable()';
        }
        if (f.description) expr += `.describe("${escapeString(f.description)}")`;
        return renderObjectMember(applyCase(f.name, keyCase), expr, member.getter);
    });
}

/**
 * One `format()` schema and its type: `wrapper({ …body })` piped through a `.transform()` from the
 * `inputCase` keys to the `outputCase` ones. Shared by the single-schema path and both halves of a
 * model split for readonly/writeonly fields, so the three cannot drift apart.
 */
function renderCasedSchema(
    name: string,
    fields: FieldNode[],
    wrapper: string,
    inputCase: 'snake' | 'pascal' | undefined,
    outputCase: 'snake' | 'pascal' | undefined,
    body: string[],
): string[] {
    const lines: string[] = [];
    lines.push(`export const ${name} = ${wrapper}({`);
    lines.push(...body.map(l => `    ${l}`));
    lines.push(`}).transform(data => ({`);
    for (const field of fields) {
        const inputKey = applyCase(field.name, inputCase);
        const outputKey = applyCase(field.name, outputCase);
        if (field.optional) {
            // Conditional spread keeps the field optional (`k?: T`) in the inferred
            // z.output / z.input type, instead of widening to required-nullable (`k: T | undefined`).
            // Consumer code built with `...(x ? { k: x } : {})` is only assignable to the optional form.
            // When inputCase is set, the input schema uses `.nullish()` so the guard must reject both
            // null and undefined; otherwise `.optional()` only allows undefined.
            const guard = inputCase ? `data.${inputKey} != null` : `data.${inputKey} !== undefined`;
            lines.push(`    ...(${guard} ? { ${quoteKey(outputKey)}: data.${inputKey} } : {}),`);
        } else {
            lines.push(`    ${quoteKey(outputKey)}: data.${inputKey},`);
        }
    }
    lines.push(`}));`);
    // When only outputCase is set, the developer-facing type is the schema's
    // pre-transform shape (camelCase). With inputCase, the post-transform
    // shape is what consumers work with.
    const typeSource = outputCase && !inputCase ? 'input' : 'output';
    lines.push(`export type ${name} = z.${typeSource}<typeof ${name}>;`);
    return lines;
}

/**
 * An anonymous object under a `format(input=)` model: keyed in `keyCase` on the way in and
 * transformed back to its declared camelCase names, which is what the enclosing transform reads.
 */
function renderCasedInlineObject(
    o: InlineObjectTypeNode,
    keyCase: 'snake' | 'pascal',
    defaultMode: ObjectMode | undefined,
    renderMember: (type: ContractTypeNode) => string,
): string {
    const wrapper = modeToWrapper(o.mode ?? defaultMode ?? 'strict');
    const joined = renderCasedFields(o.fields, keyCase, defaultMode, renderMember)
        .map(l => `    ${l}`)
        .join('\n');
    const transformEntries = o.fields
        .map(f => {
            const casedKey = applyCase(f.name, keyCase);
            // Optional fields use .nullish() on input. Conditional spread (instead of `?? undefined`)
            // keeps the key optional in the inferred output type (`k?: T`) rather than widening to
            // required-nullable (`k: T | undefined`).
            if (f.optional) {
                return `    ...(data.${casedKey} != null ? { ${quoteKey(f.name)}: data.${casedKey} } : {}),`;
            }
            return `    ${quoteKey(f.name)}: data.${casedKey},`;
        })
        .join('\n');
    return `${wrapper}({\n${joined}\n}).transform(data => ({\n${transformEntries}\n}))`;
}

/**
 * Append the modifier chain a declared field carries: nullability, then a default or optionality,
 * then the description.
 *
 * Takes a structural subset of `FieldNode` rather than the node itself, so an `OpParamNode` — which
 * is a `FieldNode` minus `visibility`, `deprecated` and `override` — can be rendered through the
 * same path. That is what lets the router, the SDK and OpenAPI agree on what an inline `query:` or
 * `headers:` field means.
 *
 * A default and `optional` are mutually exclusive on purpose: `.default()` already makes the input
 * side optional, and adding `.optional()` on top would widen the *output* type to include
 * `undefined`, which is exactly what a default exists to prevent.
 */
export function applyFieldModifiers(expr: string, field: Pick<FieldNode, 'nullable' | 'default' | 'optional' | 'description'>): string {
    if (field.nullable) expr += '.nullable()';
    if (field.default !== undefined) {
        const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
        expr += `.default(${dv})`;
    } else if (field.optional) {
        expr += '.optional()';
    }
    if (field.description) expr += `.describe("${escapeString(field.description)}")`;
    return expr;
}

/** True if `type` goes through `lazy()` anywhere, including inside a container or a union. */
function containsLazy(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'lazy':
            return true;
        case 'array':
            return containsLazy(type.item);
        case 'tuple':
            return type.items.some(containsLazy);
        case 'record':
            return containsLazy(type.key) || containsLazy(type.value);
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            return type.members.some(containsLazy);
        case 'inlineObject':
            return type.fields.some(f => containsLazy(f.type));
        default:
            return false;
    }
}

/**
 * `type` with every `lazy()` replaced by what it wraps. Used for a member written as a getter, where
 * the getter already defers the read. Leaving `z.lazy` in place there is not harmless:
 * `get children() { return z.array(z.lazy(() => Folder)); }` still defeats inference, and the
 * member fails with TS2322 against Zod's `SomeType`.
 */
function withoutLazy(type: ContractTypeNode): ContractTypeNode {
    switch (type.kind) {
        case 'lazy':
            return withoutLazy(type.inner);
        case 'array':
            return { ...type, item: withoutLazy(type.item) };
        case 'tuple':
            return { ...type, items: type.items.map(withoutLazy) };
        case 'record':
            return { ...type, key: withoutLazy(type.key), value: withoutLazy(type.value) };
        case 'union':
            return { ...type, members: type.members.map(withoutLazy) };
        case 'discriminatedUnion':
            return { ...type, members: type.members.map(withoutLazy) };
        case 'intersection':
            return { ...type, members: type.members.map(withoutLazy) };
        case 'inlineObject':
            return { ...type, fields: type.fields.map(f => ({ ...f, type: withoutLazy(f.type) })) };
        default:
            return type;
    }
}

/**
 * The type to render for an object member, and whether the member is a getter.
 *
 * A member whose type goes through `lazy()` is written as a getter. `z.lazy(() => Folder)` inside
 * `Folder`'s own initializer makes TypeScript infer `Folder` from itself, which it cannot, so the
 * schema and every type derived from it came out `any` and strict mode reported TS7022. Zod 4 reads
 * a getter's return when it parses, and TypeScript can infer a recursive type through one, provided
 * the getter names the schema directly; see `withoutLazy`.
 */
function memberType(type: ContractTypeNode): { type: ContractTypeNode; getter: boolean } {
    return containsLazy(type) ? { type: withoutLazy(type), getter: true } : { type, getter: false };
}

/** One member of an object schema's shape: `key: expr,` or, for a recursive member, a getter. */
function renderObjectMember(key: string, expr: string, getter: boolean): string {
    return getter ? `get ${quoteKey(key)}() { return ${expr}; },` : `${quoteKey(key)}: ${expr},`;
}

function renderField(field: FieldNode, defaultMode?: ObjectMode): string[] {
    const lines: string[] = [];
    if (field.deprecated) lines.push('/** @deprecated */');

    const member = memberType(field.type);
    let expr = renderType(member.type, undefined, defaultMode);

    expr = applyFieldModifiers(expr, field);

    lines.push(renderObjectMember(field.name, expr, member.getter));
    return lines;
}

// ─── Type rendering ────────────────────────────────────────────────────────

/**
 * Render a ContractKit AST type node as a Zod schema expression string.
 *
 * @param parseCaseTransform - When set, generates a `.transform()` that remaps incoming keys from
 *   the given casing (`'snake'` | `'pascal'`) to camelCase for `inlineObject` types.
 * @param defaultMode - Fallback object mode (`'strict'` | `'strip'` | `'loose'`) when the node
 *   doesn't specify its own mode.
 */
export function renderType(type: ContractTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    switch (type.kind) {
        case 'scalar':
            return renderScalar(type);
        case 'array':
            return renderArray(type, parseCaseTransform, defaultMode);
        case 'tuple':
            return renderTuple(type);
        case 'record':
            return renderRecord(type);
        case 'enum':
            return renderEnum(type);
        case 'literal':
            return renderLiteral(type);
        case 'union':
            return renderUnion(type, parseCaseTransform, defaultMode);
        case 'discriminatedUnion':
            return renderDiscriminatedUnion(type, parseCaseTransform, defaultMode);
        case 'intersection':
            return renderIntersection(type, parseCaseTransform, defaultMode);
        case 'ref':
            return type.name;
        case 'lazy':
            return `z.lazy(() => ${renderType(type.inner, parseCaseTransform, defaultMode)})`;
        case 'inlineObject':
            return renderInlineObject(type, parseCaseTransform, defaultMode);
        default:
            return 'z.unknown()';
    }
}

/**
 * Render a regex source as a JS regex literal for `.regex(...)`. If the source already has
 * anchors (`^` at the start and/or an unescaped `$` at the end) we trust the user's intent
 * and emit it as-is; otherwise we wrap with `^...$` so contracts default to full-match
 * semantics. Forward slashes are always escaped since `/` is the literal delimiter.
 */
function renderRegexLiteral(source: string): string {
    const body = source.replace(/\//g, '\\/');
    if (regexHasAnchor(source)) return `/${body}/`;
    return `/^${body}$/`;
}

function regexHasAnchor(source: string): boolean {
    if (source.startsWith('^')) return true;
    if (!source.endsWith('$')) return false;
    // The trailing `$` is an anchor only if it isn't escaped — count immediately preceding
    // backslashes; an even count (including zero) means `$` is unescaped.
    let i = source.length - 2;
    let backslashes = 0;
    while (i >= 0 && source[i] === '\\') {
        backslashes++;
        i--;
    }
    return backslashes % 2 === 0;
}

/**
 * Coercion for the numeric scalars: convert a non-empty string, pass everything else through for
 * `z.number()` to judge.
 *
 * `z.coerce.number()` is `Number(v)`, which accepts far more than a number. `[]` and `''` become
 * `0`, `null` becomes `0`, `true` becomes `1` — so `{"quantity": []}` validated as `0` and the
 * handler ran on a value the client never sent. Only the string case is a real coercion; it exists
 * because query strings and headers arrive as text, and it stays because a JSON body carrying
 * `"42"` is common enough that rejecting it would break working callers.
 *
 * The `boolean` scalar below already has this shape and needed no change: its preprocess maps only
 * the two literal strings and hands everything else to `z.boolean()`, which rejects it.
 */
const NUMERIC_PREPROCESS = `(v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v)`;

/**
 * Coercion for `bigint`: convert only a string in the documented wire form (`BIGINT_PATTERN` in
 * plugin-docs' OpenAPI target, an optionally negative run of digits with an optional trailing `n`)
 * and pass everything else through for `z.bigint()` to reject.
 *
 * Calling `BigInt()` on any string was wrong twice over. `"abc"` made it throw a SyntaxError inside
 * the preprocess, which escapes Zod entirely, so the request failed with a 500 instead of a 400.
 * And `BigInt()` accepts more than the wire form: `"0x10"`, `""` and `" 7"` became `16n`, `0n` and
 * `7n`, values a client following the published pattern could never have meant.
 */
const BIGINT_PREPROCESS = `(val) => typeof val === 'string' && /^-?\\d+n?$/.test(val) ? BigInt(val.replace(/n$/, '')) : val`;

function renderScalar(s: ScalarTypeNode): string {
    switch (s.name) {
        case 'string': {
            let e = 'z.string()';
            if (s.min !== undefined && s.max !== undefined) e += `.min(${s.min}).max(${s.max})`;
            else if (s.min !== undefined) e += `.min(${s.min})`;
            else if (s.max !== undefined) e += `.max(${s.max})`;
            if (s.len !== undefined) e += `.length(${s.len})`;
            if (s.regex) e += `.regex(${renderRegexLiteral(s.regex)})`;
            return e;
        }
        case 'number':
        case 'int': {
            // Constraints go on the inner schema, not the outer expression: `z.preprocess` returns
            // a ZodPipe, which has no `.min()`. Same shape as the `bigint` case below.
            let inner = s.name === 'int' ? 'z.number().int()' : 'z.number()';
            if (s.min !== undefined) inner += `.min(${s.min})`;
            if (s.max !== undefined) inner += `.max(${s.max})`;
            return `z.preprocess(${NUMERIC_PREPROCESS}, ${inner})`;
        }
        case 'bigint': {
            let inner = 'z.bigint()';
            if (s.min !== undefined) inner += `.min(${s.min}n)`;
            if (s.max !== undefined) inner += `.max(${s.max}n)`;
            return `z.preprocess(${BIGINT_PREPROCESS}, ${inner})`;
        }
        case 'decimal': {
            // Deliberately no output `.transform()`: `isRevalidatable` in codegen-operation treats
            // every scalar as idempotent under re-parse, which `server.validateResponses` relies on.
            // Preprocess passes an already-`Decimal` value straight through, so parse(parse(x)) is
            // stable. Modelling this on `_ZodInterval` — which does transform — would break that.
            const checks: string[] = [];
            if (s.scale !== undefined) checks.push(`v.decimalPlaces() <= ${s.scale}`);
            if (s.min !== undefined) checks.push(`v.gte('${escapeString(String(s.min))}')`);
            if (s.max !== undefined) checks.push(`v.lte('${escapeString(String(s.max))}')`);
            if (checks.length === 0) return '_ZodDecimal';
            const messageParts: string[] = [];
            if (s.scale !== undefined) messageParts.push(`at most ${s.scale} decimal place${s.scale === 1 ? '' : 's'}`);
            if (s.min !== undefined) messageParts.push(`at least ${s.min}`);
            if (s.max !== undefined) messageParts.push(`at most ${s.max}`);
            return `_ZodDecimal.refine((v) => ${checks.join(' && ')}, { message: 'Must be ${escapeString(messageParts.join(', '))}' })`;
        }
        case 'boolean':
            return `z.preprocess((v) => v === 'true' ? true : v === 'false' ? false : v, z.boolean())`;
        case 'date': {
            const fmt = s.format ?? 'yyyy-MM-dd';
            return `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, '${escapeString(fmt)}') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format ${escapeString(fmt)}' }))`;
        }
        case 'time': {
            const fmt = s.format ?? 'HH:mm:ss';
            return `z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, '${escapeString(fmt)}') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a time in format ${escapeString(fmt)}' }))`;
        }
        case 'datetime':
            return '_ZodDatetime';
        case 'interval':
            return '_ZodInterval';
        case 'duration': {
            const validParts = [`val instanceof Duration && val.isValid`];
            if (s.min !== undefined) validParts.push(`val.toMillis() >= Duration.fromISO('${s.min}').toMillis()`);
            if (s.max !== undefined) validParts.push(`val.toMillis() <= Duration.fromISO('${s.max}').toMillis()`);
            const validation = validParts.join(' && ');
            let message = 'Must be an ISO 8601 duration';
            if (s.min !== undefined && s.max !== undefined) message += ` between ${s.min} and ${s.max}`;
            else if (s.min !== undefined) message += ` of at least ${s.min}`;
            else if (s.max !== undefined) message += ` of at most ${s.max}`;
            return `z.preprocess((val) => typeof val === 'string' ? Duration.fromISO(val) : val, z.custom<Duration>((val) => ${validation}, { message: '${message}' }))`;
        }
        case 'email':
            return 'z.email()';
        case 'url':
            return 'z.url()';
        case 'uuid':
            return 'z.uuid()';
        case 'unknown':
            return 'z.unknown()';
        case 'null':
            return 'z.null()';
        case 'object':
            return 'z.record(z.string(), z.unknown())';
        case 'binary':
            return '_ZodBinary';
        case 'json':
            return '_ZodJson';
        default: {
            const _exhaustive: never = s.name;
            throw new Error(`plugin-typescript: unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

function renderArray(a: ArrayTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    let e = `z.array(${renderType(a.item, parseCaseTransform, defaultMode)})`;
    if (a.min !== undefined) e += `.min(${a.min})`;
    if (a.max !== undefined) e += `.max(${a.max})`;
    return e;
}

function renderTuple(t: TupleTypeNode): string {
    return `z.tuple([${t.items.map(i => renderType(i)).join(', ')}])`;
}

function renderRecord(r: RecordTypeNode): string {
    return `z.record(${renderType(r.key)}, ${renderType(r.value)})`;
}

function renderEnum(e: EnumTypeNode): string {
    const vals = e.values.map(v => `"${escapeString(v)}"`).join(', ');
    return `z.enum([${vals}])`;
}

function renderLiteral(l: LiteralTypeNode): string {
    if (typeof l.value === 'string') return `z.literal("${escapeString(l.value)}")`;
    return `z.literal(${l.value})`;
}

function renderUnion(u: UnionTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    return `z.union([${u.members.map(m => renderType(m, parseCaseTransform, defaultMode)).join(', ')}])`;
}

function renderDiscriminatedUnion(u: DiscriminatedUnionTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    return `z.discriminatedUnion("${escapeString(u.discriminator)}", [${u.members.map(m => renderType(m, parseCaseTransform, defaultMode)).join(', ')}])`;
}

function renderIntersection(i: IntersectionTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    const [first, ...rest] = i.members;
    // When the pattern is ref & (ref | inlineObject)*, use .extend() chains to
    // produce a single ZodObject. .and() breaks strict objects — each strict side
    // rejects the other side's keys during intersection parsing, and ZodIntersection
    // has no .strict() method.
    if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'ref' || m.kind === 'inlineObject')) {
        let expr = first.name;
        for (const member of rest) {
            if (member.kind === 'ref') {
                expr += `.extend(${member.name}.shape)`;
            } else {
                const m = member as InlineObjectTypeNode;
                const fieldLines = (
                    parseCaseTransform
                        ? renderCasedFields(m.fields, parseCaseTransform, defaultMode, t => renderType(t, parseCaseTransform, defaultMode))
                        : m.fields.flatMap(f => renderField(f, defaultMode))
                )
                    .map(l => `    ${l}`)
                    .join('\n');
                expr += `.extend({\n${fieldLines}\n})`;
            }
        }
        return expr;
    }
    let expr = renderType(first!, parseCaseTransform, defaultMode);
    for (const member of rest) {
        expr += `.and(${renderType(member, parseCaseTransform, defaultMode)})`;
    }
    return expr;
}

function renderInlineObject(o: InlineObjectTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    const wrapper = modeToWrapper(o.mode ?? defaultMode ?? 'strict');
    if (parseCaseTransform) return renderCasedInlineObject(o, parseCaseTransform, defaultMode, t => renderType(t, parseCaseTransform, defaultMode));
    const fields = o.fields
        .flatMap(f => renderField(f, defaultMode))
        .map(l => `    ${l}`)
        .join('\n');
    return `${wrapper}({\n${fields}\n})`;
}

// ─── Input type rendering ─────────────────────────────────────────────────

/**
 * The request-side rendering of a scalar. A pure passthrough today, and the seam where a genuine
 * input/wire split would live.
 *
 * The docstring here used to claim it "coerces from string input", describing a distinction the
 * body does not make: `XInput` is a single exported `const`, and `generateParamValidation`'s ref
 * branch uses that same schema for `query: X` that the body path uses for
 * `request: { application/json: X }`. Making it strict would break query-by-model; leaving it
 * coercing leaves a JSON body accepting string-shaped numbers. A real split needs a second emitted
 * schema variant plus the import plumbing to reach it, which is separate work — the narrowed
 * coercion in `renderScalar` closes the soundness hole in the meantime. (Not to be confused with the
 * SDK's `XWireInput`, a type-only variant for `format(input=)` key casing; see `codegen-wire-input`.)
 */
function renderInputScalar(s: ScalarTypeNode): string {
    return renderScalar(s);
}

/**
 * Like renderType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers, and coerces scalars from strings.
 * Used for Input (write) schema fields so that sub-type references also
 * point to their Input variants.
 *
 * @param parseCaseTransform - An enclosing `format(input=)`, which re-keys anonymous objects below it
 *   exactly as {@link renderType} does: through arrays, unions, intersections and `lazy()`, but not
 *   into a tuple or a record.
 */
export function renderInputType(
    type: ContractTypeNode,
    modelsWithInput?: Set<string>,
    defaultMode?: ObjectMode,
    parseCaseTransform?: 'snake' | 'pascal',
): string {
    const recurse = (t: ContractTypeNode) => renderInputType(t, modelsWithInput, defaultMode, parseCaseTransform);
    switch (type.kind) {
        case 'scalar':
            return renderInputScalar(type);
        case 'ref':
            return modelsWithInput?.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            let e = `z.array(${recurse(type.item)})`;
            if (type.min !== undefined) e += `.min(${type.min})`;
            if (type.max !== undefined) e += `.max(${type.max})`;
            return e;
        }
        case 'tuple':
            return `z.tuple([${type.items.map(i => renderInputType(i, modelsWithInput, defaultMode)).join(', ')}])`;
        case 'record':
            return `z.record(${renderInputType(type.key, modelsWithInput, defaultMode)}, ${renderInputType(type.value, modelsWithInput, defaultMode)})`;
        case 'union':
            return `z.union([${type.members.map(recurse).join(', ')}])`;
        case 'discriminatedUnion':
            return `z.discriminatedUnion("${escapeString(type.discriminator)}", [${type.members.map(recurse).join(', ')}])`;
        case 'intersection': {
            const [first, ...rest] = type.members;
            if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'ref' || m.kind === 'inlineObject')) {
                let expr = modelsWithInput?.has(first.name) ? `${first.name}Input` : first.name;
                for (const member of rest) {
                    if (member.kind === 'ref') {
                        const name = modelsWithInput?.has(member.name) ? `${member.name}Input` : member.name;
                        expr += `.extend(${name}.shape)`;
                    } else {
                        const inline = member as InlineObjectTypeNode;
                        const fieldLines = (
                            parseCaseTransform
                                ? renderCasedFields(inline.fields, parseCaseTransform, defaultMode, recurse)
                                : inline.fields.map(f => renderInputField(f, modelsWithInput ?? new Set(), defaultMode))
                        )
                            .map(l => `    ${l}`)
                            .join('\n');
                        expr += `.extend({\n${fieldLines}\n})`;
                    }
                }
                return expr;
            }
            let expr = recurse(first!);
            for (const member of rest) {
                expr += `.and(${recurse(member)})`;
            }
            return expr;
        }
        case 'lazy':
            return `z.lazy(() => ${recurse(type.inner)})`;
        case 'inlineObject': {
            if (parseCaseTransform) return renderCasedInlineObject(type, parseCaseTransform, defaultMode, recurse);
            const fields = type.fields
                .flatMap(f => renderInputField(f, modelsWithInput ?? new Set(), defaultMode))
                .map(l => `    ${l}`)
                .join('\n');
            return `${modeToWrapper(type.mode ?? defaultMode ?? 'strict')}({\n${fields}\n})`;
        }
        default:
            return renderType(type, undefined, defaultMode);
    }
}

function renderInputField(field: FieldNode, modelsWithInput: Set<string>, defaultMode?: ObjectMode): string[] {
    const lines: string[] = [];
    if (field.deprecated) lines.push('/** @deprecated */');

    const member = memberType(field.type);
    let expr = renderInputType(member.type, modelsWithInput, defaultMode);

    expr = applyFieldModifiers(expr, field);

    lines.push(renderObjectMember(field.name, expr, member.getter));
    return lines;
}

function renderInputFields(fields: FieldNode[], modelsWithInput: Set<string>, defaultMode?: ObjectMode): string[] {
    return fields.flatMap(f => renderInputField(f, modelsWithInput, defaultMode));
}

// ─── Query type rendering ─────────────────────────────────────────────────

/**
 * Wraps a query array's schema so a bare string is split on commas before it is validated. A query
 * string carries a one-element list as `tags=only`, which the framework parses to the string
 * `"only"`, not `["only"]`; repeated keys already arrive as an array and pass through untouched.
 */
export function queryArrayPreprocess(schema: string): string {
    return `z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, ${schema})`;
}

/**
 * Like renderType, but wraps array types with z.preprocess to handle
 * query strings where a single value arrives as a string instead of a string[].
 * Also uses Input variants for model refs when modelsWithInput is provided.
 *
 * @param models Every model a ref may name, across all files. A referenced model's schema is the one
 *   request bodies validate against, so its array fields have no split; with the models to hand, each
 *   is re-wrapped here ({@link queryArrayOverrides}). Without them a model's arrays are left as-is.
 */
export function renderQueryType(
    type: ContractTypeNode,
    modelsWithInput?: Set<string>,
    defaultMode?: ObjectMode,
    models?: Map<string, ModelNode>,
): string {
    switch (type.kind) {
        case 'array': {
            const inner = modelsWithInput ? renderInputType(type, modelsWithInput, defaultMode) : renderType(type, undefined, defaultMode);
            return queryArrayPreprocess(inner);
        }
        case 'inlineObject': {
            const fields = type.fields.map(f => `    ${renderQueryField(f, modelsWithInput, defaultMode)}`).join('\n');
            return `${modeToWrapper(type.mode ?? defaultMode ?? 'strict')}({\n${fields}\n})`;
        }
        case 'intersection': {
            const [first, ...rest] = type.members;
            if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'ref' || m.kind === 'inlineObject')) {
                let expr = modelsWithInput?.has(first.name) ? `${first.name}Input` : first.name;
                for (const member of rest) {
                    if (member.kind === 'ref') {
                        const name = modelsWithInput?.has(member.name) ? `${member.name}Input` : member.name;
                        expr += `.extend(${name}.shape)`;
                    } else {
                        const fieldLines = (member as InlineObjectTypeNode).fields
                            .map(f => `    ${renderQueryField(f, modelsWithInput, defaultMode)}`)
                            .join('\n');
                        expr += `.extend({\n${fieldLines}\n})`;
                    }
                }
                return withExtension(expr, queryArrayOverrides(type.members, modelsWithInput, models));
            }
            let expr = renderQueryType(first!, modelsWithInput, defaultMode, models);
            for (const member of rest) {
                expr += `.and(${renderQueryType(member, modelsWithInput, defaultMode, models)})`;
            }
            return expr;
        }
        case 'ref': {
            const name = modelsWithInput?.has(type.name) ? `${type.name}Input` : type.name;
            return withExtension(name, queryArrayOverrides([type], modelsWithInput, models));
        }
        default:
            return modelsWithInput ? renderInputType(type, modelsWithInput, defaultMode) : renderType(type, undefined, defaultMode);
    }
}

function renderQueryField(field: FieldNode, modelsWithInput?: Set<string>, defaultMode?: ObjectMode): string {
    let expr =
        field.type.kind === 'array'
            ? renderQueryType(field.type, modelsWithInput, defaultMode)
            : modelsWithInput
              ? renderInputType(field.type, modelsWithInput, defaultMode)
              : renderType(field.type, undefined, defaultMode);

    expr = applyFieldModifiers(expr, field);

    return `${quoteKey(field.name)}: ${expr},`;
}

/**
 * The array fields a query schema takes from referenced models, each re-wrapped in
 * {@link queryArrayPreprocess} and read back off the model's own `.shape`, so its modifiers
 * (`.optional()`, `.default()`) come along unchanged.
 *
 * Each field is taken from the member that declares it last, the one `.extend()` keeps it from. A
 * field an inline member declares last already has the preprocess, from {@link renderQueryField}.
 * One absent from the schema being extended is skipped: an `Input` variant drops readonly fields and
 * a read schema drops writeonly ones, so `.shape` has nothing to wrap for them. So is every field of
 * a model whose schema is a pipe ({@link compilesToPipe}), which has no `.shape` at all.
 *
 * @param members The query schema's members, in `.extend()` order.
 */
function queryArrayOverrides(members: readonly ContractTypeNode[], modelsWithInput?: Set<string>, models?: Map<string, ModelNode>): string[] {
    if (!models) return [];
    const owners = new Map<string, string | undefined>();
    for (const member of members) {
        if (member.kind === 'ref') {
            const isInput = modelsWithInput?.has(member.name) ?? false;
            const schema = isInput ? `${member.name}Input` : member.name;
            const extendable = !compilesToPipe(member.name, models);
            for (const f of resolveEffectiveFields(member.name, models).fields) {
                const onSchema = extendable && f.visibility !== (isInput ? 'readonly' : 'writeonly');
                owners.set(f.name, onSchema && f.type.kind === 'array' ? schema : undefined);
            }
        } else if (member.kind === 'inlineObject') {
            for (const f of member.fields) owners.set(f.name, undefined);
        }
    }
    return [...owners].flatMap(([name, schema]) => {
        if (!schema) return [];
        const shapeAccess = isValidIdentifier(name) ? `.shape.${name}` : `.shape['${escapeSingleQuoted(name)}']`;
        return [`${quoteKey(name)}: ${queryArrayPreprocess(`${schema}${shapeAccess}`)},`];
    });
}

/**
 * Whether the model's schema is an `object().transform()` pipe, because its own or an inherited
 * `format()` renames keys, or it is an alias of one that does. A pipe has no `.shape`, `.extend()` or
 * `.strict()`.
 */
export function compilesToPipe(name: string, models: Map<string, ModelNode>, seen = new Set<string>()): boolean {
    const model = models.get(name);
    if (!model || seen.has(name)) return false;
    if (model.type) return model.type.kind === 'ref' && compilesToPipe(model.type.name, models, seen.add(name));
    const flat = flattenFormatChain(model, models);
    return renamingCase(flat.inputCase) !== undefined || renamingCase(flat.outputCase) !== undefined;
}

/** `expr.extend({ ...fields })`, or `expr` alone when there are no fields to add. */
function withExtension(expr: string, fieldLines: readonly string[]): string {
    if (fieldLines.length === 0) return expr;
    return `${expr}.extend({\n${fieldLines.map(l => `    ${l}`).join('\n')}\n})`;
}

function isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function quoteKey(name: string): string {
    return isValidIdentifier(name) ? name : `'${name}'`;
}

// ─── String escaping ──────────────────────────────────────────────────────

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function rootNeedsDateTime(root: ContractRootNode): boolean {
    return root.models.some(m => (m.type && typeNeedsDateTime(m.type)) || m.fields.some(f => typeNeedsDateTime(f.type)));
}

/** Returns true if `type` (recursively) contains a scalar with the given `name`. */
export function typeNeedsScalar(type: ContractTypeNode, name: string): boolean {
    switch (type.kind) {
        case 'scalar':
            return type.name === name;
        case 'array':
            return typeNeedsScalar(type.item, name);
        case 'tuple':
            return type.items.some(i => typeNeedsScalar(i, name));
        case 'record':
            return typeNeedsScalar(type.key, name) || typeNeedsScalar(type.value, name);
        case 'union':
            return type.members.some(m => typeNeedsScalar(m, name));
        case 'discriminatedUnion':
            return type.members.some(m => typeNeedsScalar(m, name));
        case 'intersection':
            return type.members.some(m => typeNeedsScalar(m, name));
        case 'lazy':
            return typeNeedsScalar(type.inner, name);
        case 'inlineObject':
            return type.fields.some(f => typeNeedsScalar(f.type, name));
        default:
            return false;
    }
}

/** Returns true if any model in `root` uses a scalar with the given `name`. */
export function rootNeedsScalar(root: ContractRootNode, name: string): boolean {
    return root.models.some(m => (m.type && typeNeedsScalar(m.type, name)) || m.fields.some(f => typeNeedsScalar(f.type, name)));
}

/** Returns true if `type` (recursively) contains a `date`, `time`, or `datetime` scalar. */
export function typeNeedsDateTime(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'scalar':
            return type.name === 'date' || type.name === 'time' || type.name === 'datetime';
        case 'array':
            return typeNeedsDateTime(type.item);
        case 'union':
            return type.members.some(typeNeedsDateTime);
        case 'discriminatedUnion':
            return type.members.some(typeNeedsDateTime);
        case 'intersection':
            return type.members.some(typeNeedsDateTime);
        case 'inlineObject':
            return type.fields.some(f => typeNeedsDateTime(f.type));
        default:
            return false;
    }
}

/**
 * The models `generateContract` and `generatePlainTypes` resolve bases against: every file's, from
 * the context, with this file's own winning.
 */
export function contractModelMap(root: ContractRootNode, context?: ContractCodegenContext): Map<string, ModelNode> {
    return new Map([...(context?.modelMap ?? []), ...root.models.map(m => [m.name, m] as const)]);
}

/** Collect model names referenced in `root` that are not defined locally (need to be imported). */
export function collectExternalRefs(root: ContractRootNode): string[] {
    const localNames = new Set(root.models.map(m => m.name));
    const refs = new Set<string>();

    for (const model of root.models) {
        // Every base: `C: A & B` emits `A.extend(B.shape)` and `interface C extends A, B`.
        for (const base of model.bases ?? []) if (!localNames.has(base)) refs.add(base);
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
        // Type alias: collect Input refs from the aliased type expression.
        if (model.type) {
            collectInputTypeRefs(model.type, refs, modelsWithInput);
            continue;
        }
        // When a model extends an external parent that has an Input variant, the write schema
        // extends ParentInput (every base, via `buildExtendChain`) — so we need to import it.
        for (const base of model.bases ?? []) {
            if (modelsWithInput.has(base) && !localNames.has(base)) refs.add(`${base}Input`);
        }
        const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
        for (const field of writeFields) {
            collectInputTypeRefs(field.type, refs, modelsWithInput);
        }
    }

    // Remove locally defined Input variants (generated in this file)
    for (const name of localNames) {
        refs.delete(`${name}Input`);
    }

    return [...refs].sort();
}

function collectInputTypeRefs(type: ContractTypeNode, out: Set<string>, modelsWithInput: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            if (modelsWithInput.has(type.name)) out.add(`${type.name}Input`);
            break;
        case 'array':
            collectInputTypeRefs(type.item, out, modelsWithInput);
            break;
        case 'tuple':
            type.items.forEach(i => collectInputTypeRefs(i, out, modelsWithInput));
            break;
        case 'record':
            collectInputTypeRefs(type.key, out, modelsWithInput);
            collectInputTypeRefs(type.value, out, modelsWithInput);
            break;
        case 'union':
            type.members.forEach(m => collectInputTypeRefs(m, out, modelsWithInput));
            break;
        case 'discriminatedUnion':
            type.members.forEach(m => collectInputTypeRefs(m, out, modelsWithInput));
            break;
        case 'intersection':
            type.members.forEach(m => collectInputTypeRefs(m, out, modelsWithInput));
            break;
        case 'lazy':
            collectInputTypeRefs(type.inner, out, modelsWithInput);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectInputTypeRefs(f.type, out, modelsWithInput));
            break;
    }
}

/**
 * Like core's `collectTypeRefs`, but stops at `lazy()`.
 *
 * A lazy reference is read when the schema parses, not when the module loads, so it places no
 * constraint on declaration order. Counting it as one turns every recursive pair into a cycle:
 * `Folder { readme: Doc }` and `Doc { folder: lazy(Folder) }` fell back to source order, put
 * `Folder` first, and evaluated `Doc.optional()` before `Doc` was declared.
 */
function collectEagerTypeRefs(type: ContractTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            out.add(type.name);
            break;
        case 'array':
            collectEagerTypeRefs(type.item, out);
            break;
        case 'tuple':
            type.items.forEach(t => collectEagerTypeRefs(t, out));
            break;
        case 'record':
            collectEagerTypeRefs(type.key, out);
            collectEagerTypeRefs(type.value, out);
            break;
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            type.members.forEach(t => collectEagerTypeRefs(t, out));
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectEagerTypeRefs(f.type, out));
            break;
        case 'lazy':
            break;
    }
}

/**
 * Topologically sort models so dependencies are emitted before dependents. Only references
 * evaluated at module load count; see `collectEagerTypeRefs`. Falls back to source order for a
 * cycle of eager references, which no ordering can satisfy.
 */
export function topoSortModels(models: ModelNode[]): ModelNode[] {
    const localNames = new Set(models.map(m => m.name));
    const modelMap = new Map(models.map(m => [m.name, m]));

    // Build adjacency: model name → set of local model names it depends on
    const deps = new Map<string, Set<string>>();
    for (const model of models) {
        const refs = new Set<string>();
        // Every base, not only the first: `C: A & B` emits `A.extend(B.shape)`, which reads B at load.
        for (const base of model.bases ?? []) refs.add(base);
        if (model.type) collectEagerTypeRefs(model.type, refs);
        for (const field of model.fields) {
            collectEagerTypeRefs(field.type, refs);
        }
        // Keep only local dependencies
        const localDeps = new Set<string>();
        for (const r of refs) {
            if (localNames.has(r) && r !== model.name) localDeps.add(r);
        }
        deps.set(model.name, localDeps);
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const name of localNames) inDegree.set(name, 0);
    for (const [, d] of deps) {
        for (const dep of d) {
            inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
        }
    }

    // Note: inDegree counts how many models *depend on* this model,
    // but for Kahn's we need how many dependencies each model has.
    // Re-do: inDegree = number of unresolved deps for each model.
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
        // Remove this model from all dependents' remaining sets
        for (const [other, rem] of remaining) {
            if (rem.delete(name) && rem.size === 0) {
                queue.push(other);
            }
        }
    }

    // Append any models not yet emitted (cycles)
    for (const model of models) {
        if (!sorted.includes(model)) sorted.push(model);
    }

    return sorted;
}

/**
 * Resolve the import path for an external model reference.
 * When a codegen context is available, computes the correct relative path
 * from the current file to the referenced model's output file.
 * Falls back to same-directory PascalCase → dot.case convention.
 */
export function resolveImportPath(refName: string, context?: ContractCodegenContext): string {
    if (context) {
        const refOutPath = context.modelOutPaths.get(refName);
        if (refOutPath) {
            const fromDir = dirname(context.currentOutPath);
            let rel = relative(fromDir, refOutPath);
            // Replace .ts extension with .js for ESM imports
            rel = rel.replace(/\.ts$/, '.js');
            // Ensure relative path starts with ./ or ../
            if (!rel.startsWith('.')) rel = './' + rel;
            return rel;
        }
    }
    // Fallback: assume same directory, use PascalCase → dot.case convention
    const moduleName = pascalToDotCase(refName);
    return `./${moduleName}.js`;
}

/** Convert PascalCase to dot-separated lowercase: CounterpartyAccount → counterparty.account */
export function pascalToDotCase(name: string): string {
    return name.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase();
}
