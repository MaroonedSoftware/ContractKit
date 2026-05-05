import { relative, dirname } from 'node:path';
import type { ContractRootNode, ModelNode, FieldNode } from '@contractkit/core';
import { computeModelsWithOutput, collectExternalOutputRefs } from '@contractkit/core';
import type { ContractCodegenContext } from './codegen-contract.js';
import {
    collectExternalRefs,
    collectExternalInputRefs,
    computeModelsWithInput,
    topoSortModels,
    resolveImportPath,
    rootNeedsScalar,
} from './codegen-contract.js';
import { renderTsType, renderInputTsType, renderOutputTsType, quoteKey, JSON_VALUE_TYPE_DECL } from './ts-render.js';

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Generate plain TypeScript interfaces/types from a contract AST.
 * Unlike `generateContract()` which produces Zod schemas, this emits
 * vanilla TypeScript `interface` and `type` declarations suitable
 * for SDK consumers that don't need runtime validation.
 */
export function generatePlainTypes(root: ContractRootNode, context?: ContractCodegenContext): string {
    const externalRefs = collectExternalRefs(root);
    const lines: string[] = [];

    // Compute which models have Input variants (local, incl. transitive deps + external)
    const externalModelsWithInput = context?.modelsWithInput ?? new Set<string>();
    const localModelsWithInput = computeModelsWithInput(root.models, externalModelsWithInput);
    const allModelsWithInput = new Set([...localModelsWithInput, ...externalModelsWithInput]);

    // Compute which models have Output variants (post-transform wire shape)
    const externalModelsWithOutput = context?.modelsWithOutput ?? new Set<string>();
    const localModelsWithOutput = computeModelsWithOutput(root.models, externalModelsWithOutput);
    const allModelsWithOutput = new Set([...localModelsWithOutput, ...externalModelsWithOutput]);

    // Collect additional external Input/Output refs needed for variant fields
    const externalInputRefs = allModelsWithInput.size > 0 ? collectExternalInputRefs(root, allModelsWithInput) : [];
    const externalOutputRefs = allModelsWithOutput.size > 0 ? collectExternalOutputRefs(root, allModelsWithOutput) : [];
    const allExternalRefs = [...new Set([...externalRefs, ...externalInputRefs, ...externalOutputRefs])].sort();

    // Type-only imports for external references
    for (const ref of allExternalRefs) {
        const importPath = resolveImportPath(ref, context);
        lines.push(`import type { ${ref} } from '${importPath}';`);
    }
    if (allExternalRefs.length > 0) lines.push('');

    if (rootNeedsScalar(root, 'json')) {
        if (context?.jsonValueImportPath) {
            lines.push(`import type { JsonValue } from '${context.jsonValueImportPath}';`);
        } else {
            lines.push(JSON_VALUE_TYPE_DECL);
        }
        lines.push('');
    }

    const modelMap = new Map(root.models.map(m => [m.name, m]));

    for (const model of topoSortModels(root.models)) {
        lines.push(...generateModel(model, context?.currentOutPath, allModelsWithInput, allModelsWithOutput, modelMap));
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(
    model: ModelNode,
    outPath?: string,
    modelsWithInput?: Set<string>,
    modelsWithOutput?: Set<string>,
    modelMap?: Map<string, ModelNode>,
): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, outPath, modelsWithInput, modelsWithOutput);
    }

    // A model needs Input/read split if it has visibility-modified fields OR if it
    // transitively references models that have Input variants (captured in modelsWithInput).
    const needsInputSplit = model.fields.some(f => f.visibility !== 'normal') || (modelsWithInput?.has(model.name) ?? false);

    const lines = needsInputSplit ? generateVisibilityModel(model, outPath, modelsWithInput, modelMap) : generateSimpleModel(model, outPath, modelMap);

    if (modelsWithOutput?.has(model.name)) {
        lines.push('');
        lines.push(...generateOutputModel(model, modelsWithOutput));
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
        lines.push(` * ${model.description}`);
    }

    const relPath = outPath ? relative(dirname(outPath), model.loc.file) : model.loc.file;
    lines.push(` * generated from [${model.name}](file://./${relPath}#L${model.loc.line})`);
    lines.push(' */');
    return lines;
}

function generateTypeAlias(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>, modelsWithOutput?: Set<string>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export type ${model.name} = ${renderTsType(model.type!)};`);
    if (modelsWithInput?.has(model.name)) {
        lines.push(`export type ${model.name}Input = ${renderInputTsType(model.type!, modelsWithInput)};`);
    }
    if (modelsWithOutput?.has(model.name)) {
        lines.push(`export type ${model.name}Output = ${renderOutputTsType(model.type!, modelsWithOutput)};`);
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

function generateSimpleModel(model: ModelNode, outPath?: string, modelMap?: Map<string, ModelNode>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const bases = model.bases ?? [];
    const overrideNames = computeOverrideNames(model, modelMap);
    lines.push(`export interface ${model.name}${buildExtendsClause(bases, overrideNames, b => b)} {`);

    for (const field of model.fields) {
        lines.push(`    ${renderField(field)}`);
    }

    lines.push('}');
    return lines;
}

function generateVisibilityModel(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>, modelMap?: Map<string, ModelNode>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const bases = model.bases ?? [];
    const overrideNames = computeOverrideNames(model, modelMap);

    // Read type — omit writeonly fields
    const readFields = model.fields.filter(f => f.visibility !== 'writeonly');
    lines.push(`export interface ${model.name}${buildExtendsClause(bases, overrideNames, b => b)} {`);
    for (const field of readFields) {
        lines.push(`    ${renderField(field)}`);
    }
    lines.push('}');
    lines.push('');

    // Write type — omit readonly fields (use Input variants for sub-type refs);
    // extends ParentInput if parent has an Input variant, else extends parent read type
    const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
    const inputResolver = (b: string) => (modelsWithInput?.has(b) ? `${b}Input` : b);
    lines.push(`export interface ${model.name}Input${buildExtendsClause(bases, overrideNames, inputResolver)} {`);
    for (const field of writeFields) {
        lines.push(`    ${modelsWithInput ? renderInputField(field, modelsWithInput) : renderField(field)}`);
    }
    lines.push('}');

    return lines;
}

// ─── Field rendering ──────────────────────────────────────────────────────

function renderField(field: FieldNode): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    let typeStr = renderTsType(field.type);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(field.name)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    if (jsdocParts.length > 0) {
        return `/** ${jsdocParts.join(' ')} */\n    ${line}`;
    }
    return line;
}

function renderInputField(field: FieldNode, modelsWithInput: Set<string>): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    let typeStr = renderInputTsType(field.type, modelsWithInput);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(field.name)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    if (jsdocParts.length > 0) {
        return `/** ${jsdocParts.join(' ')} */\n    ${line}`;
    }
    return line;
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
 * - Direct hits (model.outputCase set): rename keys per the transform and substitute nested refs.
 * - Transitive hits: keep field names as-is but substitute nested refs with their Output variants.
 *
 * `extends` is dropped for direct-hit models because the Zod schema flattens fields when an
 * ancestor has format(...) (see `flattenFormatChain` in codegen-contract); we mirror that here
 * so the plain interface matches the wire shape produced by the Zod transform.
 */
function generateOutputModel(model: ModelNode, modelsWithOutput: Set<string>): string[] {
    const lines: string[] = [];
    const outputCase = model.outputCase && model.outputCase !== 'camel' ? model.outputCase : undefined;
    const readFields = model.fields.filter(f => f.visibility !== 'writeonly');

    // Transitive-only (no direct outputCase): preserve `extends` and original key names.
    if (!outputCase) {
        const baseExt =
            model.bases?.[0] && modelsWithOutput.has(model.bases?.[0])
                ? ` extends ${model.bases?.[0]}Output`
                : model.bases?.[0]
                  ? ` extends ${model.bases?.[0]}`
                  : '';
        lines.push(`export interface ${model.name}Output${baseExt} {`);
        for (const field of readFields) {
            lines.push(`    ${renderOutputField(field, model.outputCase, modelsWithOutput)}`);
        }
        lines.push('}');
        return lines;
    }

    // Direct hit: emit a flat interface with renamed keys.
    lines.push(`export interface ${model.name}Output {`);
    for (const field of readFields) {
        lines.push(`    ${renderOutputField(field, outputCase, modelsWithOutput)}`);
    }
    lines.push('}');
    return lines;
}

function renderOutputField(field: FieldNode, outputCase: 'camel' | 'snake' | 'pascal' | undefined, modelsWithOutput: Set<string>): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    const key = applyOutputCase(field.name, outputCase);
    let typeStr = renderOutputTsType(field.type, modelsWithOutput);
    if (field.nullable) typeStr += ' | null';
    const line = `${quoteKey(key)}${opt}: ${typeStr};`;
    const jsdocParts: string[] = [];
    if (field.deprecated) jsdocParts.push('@deprecated');
    if (field.description) jsdocParts.push(field.description);
    if (jsdocParts.length > 0) {
        return `/** ${jsdocParts.join(' ')} */\n    ${line}`;
    }
    return line;
}
