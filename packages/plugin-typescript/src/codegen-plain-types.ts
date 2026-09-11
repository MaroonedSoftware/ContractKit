import type { ContractRootNode, ModelNode, FieldNode } from '@contractkit/core';
import { computeModelsWithOutput, collectExternalOutputRefs } from '@contractkit/core';
import type { ContractCodegenContext } from './codegen-contract.js';
import {
    collectExternalRefs,
    collectExternalInputRefs,
    computeModelsWithInput,
    contractModelMap,
    topoSortModels,
    resolveImportPath,
    rootNeedsScalar,
} from './codegen-contract.js';
import { renderTsType, renderInputTsType, renderOutputTsType, quoteKey, escapeJsDocLines, sourceLink, withFieldJsDoc, JSON_VALUE_TYPE_DECL } from './ts-render.js';
import type { TsRenderTarget } from './ts-render.js';
import { collectExternalWireInputRefs, flattenFormatChain, renderWireInputModel } from './codegen-wire-input.js';
import type { WireInputRenderContext } from './codegen-wire-input.js';
import { DECIMAL_IMPORT, DECIMAL_CONFIG_LINE } from './decimal-runtime.js';
import { renderReviveFunctions, reviveFnName, coerceDeclsFor } from './codegen-revive.js';

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Generate plain TypeScript interfaces/types from a contract AST.
 * Unlike `generateContract()` which produces Zod schemas, this emits
 * vanilla TypeScript `interface` and `type` declarations suitable
 * for SDK consumers that don't need runtime validation.
 *
 * @param context Import resolution and Input/Output variant sets. `context.target` selects the
 * runtime the types describe (`'server'` renders `binary` as `Buffer`, `'client'` as `Blob`).
 */
export function generatePlainTypes(root: ContractRootNode, context?: ContractCodegenContext): string {
    const target: TsRenderTarget = context?.target ?? 'client';
    const modelMap = contractModelMap(root, context);
    // The `XOutput`, `XWireInput` and reviver renderings flatten a `format()` contract's bases the
    // way its schema does, so they can name types and scalars that only a base's fields bring in.
    const effectiveRoot = { ...root, models: root.models.map(m => (m.type ? m : flattenFormatChain(m, modelMap))) };

    // Compute which models have Input variants (local, incl. transitive deps + external)
    const externalModelsWithInput = context?.modelsWithInput ?? new Set<string>();
    const localModelsWithInput = computeModelsWithInput(root.models, externalModelsWithInput);
    const allModelsWithInput = new Set([...localModelsWithInput, ...externalModelsWithInput]);

    // Compute which models have Output variants (post-transform wire shape)
    const externalModelsWithOutput = context?.modelsWithOutput ?? new Set<string>();
    const localModelsWithOutput = computeModelsWithOutput(root.models, externalModelsWithOutput);
    const allModelsWithOutput = new Set([...localModelsWithOutput, ...externalModelsWithOutput]);

    const wireCtx: WireInputRenderContext | undefined = context?.modelsWithWireInput
        ? { modelsWithInput: allModelsWithInput, modelsWithWireInput: context.modelsWithWireInput, modelMap, target, jsonType: 'JsonValue' }
        : undefined;

    const reviveOpts =
        context?.emitRevivers && context.modelsWithDecimal
            ? { modelsWithDecimal: context.modelsWithDecimal, modelsWithOutput: allModelsWithOutput, modelMap }
            : undefined;

    const bodyLines: string[] = [];
    for (const model of topoSortModels(root.models)) {
        bodyLines.push(...generateModel(model, target, context?.currentOutPath, allModelsWithInput, allModelsWithOutput, modelMap));
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

    // What a flattened base brings in is imported only if the body names it: whether it does
    // depends on which of the three renderings above the contract gets, and an unused import
    // fails `noUnusedLocals`. Everything the declared shape needs is imported unconditionally, as before.
    const body = bodyLines.join('\n');
    const mentions = (name: string) => new RegExp(`(?<![A-Za-z0-9_$])${name.replace(/[$]/g, '\\$&')}(?![A-Za-z0-9_$])`).test(body);
    const needs = (scalar: string, typeName: string) =>
        rootNeedsScalar(root, scalar) || (rootNeedsScalar(effectiveRoot, scalar) && mentions(typeName));

    const lines: string[] = [];

    // Collect additional external Input/Output refs needed for variant fields
    const externalRefs = collectExternalRefs(root);
    const externalInputRefs = allModelsWithInput.size > 0 ? collectExternalInputRefs(root, allModelsWithInput) : [];
    const externalOutputRefs = allModelsWithOutput.size > 0 ? collectExternalOutputRefs(root, allModelsWithOutput) : [];
    const externalWireInputRefs = wireCtx ? collectExternalWireInputRefs(root, wireCtx) : [];
    const declaredRefs = new Set([...externalRefs, ...externalInputRefs, ...externalOutputRefs, ...externalWireInputRefs]);
    const flattenedRefs = [
        ...collectExternalRefs(effectiveRoot),
        ...(allModelsWithInput.size > 0 ? collectExternalInputRefs(effectiveRoot, allModelsWithInput) : []),
        ...(allModelsWithOutput.size > 0 ? collectExternalOutputRefs(effectiveRoot, allModelsWithOutput) : []),
    ].filter(ref => !declaredRefs.has(ref) && mentions(ref));
    const allExternalRefs = [...new Set([...declaredRefs, ...flattenedRefs])].sort();

    // Not `import type`: `renderTsScalar` maps `decimal` to `Decimal` in this mode too, so the class
    // is a real runtime dependency of any consumer holding one — same position as in
    // `generateContract`, which emits it ahead of the external model refs.
    const needsDecimal =
        needs('decimal', 'Decimal') ||
        (context?.emitRevivers && context.modelsWithDecimal ? root.models.some(m => context.modelsWithDecimal!.has(m.name)) : false);
    if (needsDecimal) lines.push(DECIMAL_IMPORT);

    // Likewise for the temporal scalars: `renderTsScalar` maps them to Luxon classes, which are a
    // real runtime dependency of anyone holding one. `interval` is not among them — it renders as
    // a string, since `_ZodInterval` transforms back to ISO on output.
    const luxonImports: string[] = [];
    if (needs('date', 'DateTime') || needs('time', 'DateTime') || needs('datetime', 'DateTime')) luxonImports.push('DateTime');
    if (needs('duration', 'Duration')) luxonImports.push('Duration');
    if (luxonImports.length > 0) lines.push(`import { ${luxonImports.join(', ')} } from 'luxon';`);

    // Type-only imports for external references. A cross-file model carrying a decimal also
    // contributes its reviver, which is a value and so needs a second, non-type import.
    for (const ref of allExternalRefs) {
        const importPath = resolveImportPath(ref, context);
        lines.push(`import type { ${ref} } from '${importPath}';`);
        if (context?.emitRevivers && context.modelsWithDecimal?.has(ref) && (declaredRefs.has(ref) || mentions(reviveFnName(ref)))) {
            lines.push(`import { ${reviveFnName(ref)} } from '${importPath}';`);
        }
    }
    if (allExternalRefs.length > 0) lines.push('');

    if (needs('json', 'JsonValue')) {
        if (context?.jsonValueImportPath) {
            lines.push(`import type { JsonValue } from '${context.jsonValueImportPath}';`);
        } else {
            lines.push(JSON_VALUE_TYPE_DECL);
        }
        lines.push('');
    }

    // Global decimal.js config belongs in any file holding a `Decimal`: there is no Zod schema in
    // this mode, but `String(value)` and `JSON.stringify` still have to stay out of exponential form.
    if (needsDecimal) {
        lines.push('');
        lines.push(DECIMAL_CONFIG_LINE);
    }

    // Same rule as in `generateContract`: a helper is emitted only if the revivers actually
    // reference it, so the two cannot drift and trip `noUnusedLocals`.
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
    target: TsRenderTarget,
    outPath: string | undefined,
    modelsWithInput: Set<string> | undefined,
    modelsWithOutput: Set<string> | undefined,
    modelMap: Map<string, ModelNode>,
): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, target, outPath, modelsWithInput, modelsWithOutput);
    }

    // A model needs Input/read split if it has visibility-modified fields OR if it
    // transitively references models that have Input variants (captured in modelsWithInput).
    const needsInputSplit = model.fields.some(f => f.visibility !== 'normal') || (modelsWithInput?.has(model.name) ?? false);

    const lines = needsInputSplit
        ? generateVisibilityModel(model, target, outPath, modelsWithInput, modelMap)
        : generateSimpleModel(model, target, outPath, modelMap);

    if (modelsWithOutput?.has(model.name)) {
        lines.push('');
        lines.push(...generateOutputModel(model, target, modelsWithOutput, modelMap));
    }
    return lines;
}

/** Recursively collect every field name defined on `bases` and their ancestors. Used to detect
 * fields that the child re-declares without an explicit `override` keyword — those still need an
 * `Omit<Base, …>` wrap, otherwise the child's narrower/incompatible declaration collides with the
 * inherited one. */
function collectInheritedFieldNames(bases: string[], modelMap: Map<string, ModelNode>): Set<string> {
    const result = new Set<string>();
    const visit = (name: string): void => {
        const m = modelMap.get(name);
        if (!m || m.type) return;
        for (const f of m.fields) result.add(f.name);
        for (const b of m.bases ?? []) visit(b);
    };
    for (const b of bases) visit(b);
    return result;
}

/** Names of fields the child declaration overrides — explicit `override` plus any field whose
 * name shadows an inherited one. The latter catches single-base redeclarations that omit the
 * `override` keyword (e.g. narrowing `kind: BusinessRoleKind` → `kind: 'employee'`). */
function computeOverrideNames(model: ModelNode, modelMap?: Map<string, ModelNode>): string[] {
    const inherited = modelMap ? collectInheritedFieldNames(model.bases ?? [], modelMap) : new Set<string>();
    return model.fields.filter(f => f.override || inherited.has(f.name)).map(f => f.name);
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
    lines.push(' */');
    return lines;
}

function generateTypeAlias(
    model: ModelNode,
    target: TsRenderTarget,
    outPath?: string,
    modelsWithInput?: Set<string>,
    modelsWithOutput?: Set<string>,
): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export type ${model.name} = ${renderTsType(model.type!, target)};`);
    if (modelsWithInput?.has(model.name)) {
        lines.push(`export type ${model.name}Input = ${renderInputTsType(model.type!, modelsWithInput, target)};`);
    }
    if (modelsWithOutput?.has(model.name)) {
        lines.push(`export type ${model.name}Output = ${renderOutputTsType(model.type!, modelsWithOutput, target)};`);
    }
    return lines;
}

/** Build the `extends` clause for a model.
 * Each entry in `overrideNames` is wrapped in `Omit<Base, 'name1' | 'name2'>` per base so the
 * subclass can legally redeclare those fields with new (possibly incompatible) types.
 * TypeScript's `Omit<T, K extends keyof any>` tolerates omit keys that don't appear on the base,
 * so we apply the same omit list to every base without per-base field-set lookup. */
function buildExtendsClause(bases: string[], overrideNames: string[], baseNameResolver: (b: string) => string): string {
    if (bases.length === 0) return '';
    if (overrideNames.length === 0) return ` extends ${bases.map(baseNameResolver).join(', ')}`;
    const omitKeys = overrideNames.map(n => `'${n}'`).join(' | ');
    const wrapped = bases.map(b => `Omit<${baseNameResolver(b)}, ${omitKeys}>`);
    return ` extends ${wrapped.join(', ')}`;
}

function generateSimpleModel(model: ModelNode, target: TsRenderTarget, outPath?: string, modelMap?: Map<string, ModelNode>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const bases = model.bases ?? [];
    const overrideNames = computeOverrideNames(model, modelMap);
    lines.push(`export interface ${model.name}${buildExtendsClause(bases, overrideNames, b => b)} {`);

    for (const field of model.fields) {
        lines.push(`    ${renderField(field, target)}`);
    }

    lines.push('}');
    return lines;
}

function generateVisibilityModel(
    model: ModelNode,
    target: TsRenderTarget,
    outPath?: string,
    modelsWithInput?: Set<string>,
    modelMap?: Map<string, ModelNode>,
): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const bases = model.bases ?? [];
    const overrideNames = computeOverrideNames(model, modelMap);

    // Read type — omit writeonly fields
    const readFields = model.fields.filter(f => f.visibility !== 'writeonly');
    lines.push(`export interface ${model.name}${buildExtendsClause(bases, overrideNames, b => b)} {`);
    for (const field of readFields) {
        lines.push(`    ${renderField(field, target)}`);
    }
    lines.push('}');
    lines.push('');

    // Write type — omit readonly fields (use Input variants for sub-type refs);
    // extends ParentInput if parent has an Input variant, else extends parent read type
    const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
    const inputResolver = (b: string) => (modelsWithInput?.has(b) ? `${b}Input` : b);
    lines.push(`export interface ${model.name}Input${buildExtendsClause(bases, overrideNames, inputResolver)} {`);
    for (const field of writeFields) {
        lines.push(`    ${modelsWithInput ? renderInputField(field, modelsWithInput, target) : renderField(field, target)}`);
    }
    lines.push('}');

    return lines;
}

// ─── Field rendering ──────────────────────────────────────────────────────

function renderField(field: FieldNode, target: TsRenderTarget): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    let typeStr = renderTsType(field.type, target);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(field.name)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    return withFieldJsDoc(jsdocParts, line);
}

function renderInputField(field: FieldNode, modelsWithInput: Set<string>, target: TsRenderTarget): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    let typeStr = renderInputTsType(field.type, modelsWithInput, target);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(field.name)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    return withFieldJsDoc(jsdocParts, line);
}

// ─── Output (post-transform wire shape) ──────────────────────────────────

function camelToSnake(s: string): string {
    return s.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
}

function camelToPascal(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function applyOutputCase(name: string, c: 'camel' | 'snake' | 'pascal' | undefined): string {
    if (!c || c === 'camel') return name;
    if (c === 'snake') return camelToSnake(name);
    return camelToPascal(name);
}

/**
 * Emit `${name}Output` for a model in the output transitive set.
 * - A model its schema flattens (a `format()` applies, its own or inherited): one flat interface
 *   of every field it carries, bases included, keyed by the output casing, with nested refs
 *   substituted. `extends` would describe the bases' keys, not the transform's.
 * - Otherwise (transitive hits): keep field names as-is, extend each base by its Output variant
 *   where it has one, and substitute nested refs with their Output variants.
 */
function generateOutputModel(model: ModelNode, target: TsRenderTarget, modelsWithOutput: Set<string>, modelMap: Map<string, ModelNode>): string[] {
    const lines: string[] = [];
    const effective = flattenFormatChain(model, modelMap);
    const readFields = effective.fields.filter(f => f.visibility !== 'writeonly');
    const renames = (c: ModelNode['outputCase']) => c !== undefined && c !== 'camel';

    if (!renames(effective.inputCase) && !renames(effective.outputCase)) {
        const bases = model.bases ?? [];
        const extendsClause = buildExtendsClause(bases, computeOverrideNames(model, modelMap), b => (modelsWithOutput.has(b) ? `${b}Output` : b));
        lines.push(`export interface ${model.name}Output${extendsClause} {`);
        for (const field of readFields) {
            lines.push(`    ${renderOutputField(field, undefined, modelsWithOutput, target)}`);
        }
        lines.push('}');
        return lines;
    }

    const outputCase = renames(effective.outputCase) ? effective.outputCase : undefined;
    lines.push(`export interface ${model.name}Output {`);
    for (const field of readFields) {
        lines.push(`    ${renderOutputField(field, outputCase, modelsWithOutput, target)}`);
    }
    lines.push('}');
    return lines;
}

function renderOutputField(
    field: FieldNode,
    outputCase: 'camel' | 'snake' | 'pascal' | undefined,
    modelsWithOutput: Set<string>,
    target: TsRenderTarget,
): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    const key = applyOutputCase(field.name, outputCase);
    let typeStr = renderOutputTsType(field.type, modelsWithOutput, target);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(key)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    return withFieldJsDoc(jsdocParts, line);
}
