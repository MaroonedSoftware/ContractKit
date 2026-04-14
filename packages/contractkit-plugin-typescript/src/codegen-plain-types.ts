import { relative, dirname } from 'node:path';
import type { ContractRootNode, ModelNode, FieldNode } from '@maroonedsoftware/contractkit';
import type { ContractCodegenContext } from '@maroonedsoftware/contractkit';
import {
    collectExternalRefs,
    collectExternalInputRefs,
    computeModelsWithInput,
    topoSortModels,
    resolveImportPath,
    rootNeedsScalar,
} from '@maroonedsoftware/contractkit';
import { renderTsType, renderInputTsType, quoteKey, JSON_VALUE_TYPE_DECL } from '@maroonedsoftware/contractkit';

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Generate plain TypeScript interfaces/types from a DTO AST.
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

    // Collect additional external Input refs needed for Input schema fields
    const externalInputRefs = allModelsWithInput.size > 0 ? collectExternalInputRefs(root, allModelsWithInput) : [];
    const allExternalRefs = [...new Set([...externalRefs, ...externalInputRefs])].sort();

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

    for (const model of topoSortModels(root.models)) {
        lines.push(...generateModel(model, context?.currentOutPath, allModelsWithInput));
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, outPath, modelsWithInput);
    }

    // A model needs Input/read split if it has visibility-modified fields OR if it
    // transitively references models that have Input variants (captured in modelsWithInput).
    const needsInputSplit = model.fields.some(f => f.visibility !== 'normal') || (modelsWithInput?.has(model.name) ?? false);

    if (needsInputSplit) {
        return generateVisibilityModel(model, outPath, modelsWithInput);
    }
    return generateSimpleModel(model, outPath);
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

function generateTypeAlias(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export type ${model.name} = ${renderTsType(model.type!)};`);
    if (modelsWithInput?.has(model.name)) {
        lines.push(`export type ${model.name}Input = ${renderInputTsType(model.type!, modelsWithInput)};`);
    }
    return lines;
}

function generateSimpleModel(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    if (model.base) {
        lines.push(`export interface ${model.name} extends ${model.base} {`);
    } else {
        lines.push(`export interface ${model.name} {`);
    }

    for (const field of model.fields) {
        lines.push(`    ${renderField(field)}`);
    }

    lines.push('}');
    return lines;
}

function generateVisibilityModel(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    // Read type — omit writeonly fields
    const readFields = model.fields.filter(f => f.visibility !== 'writeonly');

    if (model.base) {
        lines.push(`export interface ${model.name} extends ${model.base} {`);
    } else {
        lines.push(`export interface ${model.name} {`);
    }
    for (const field of readFields) {
        lines.push(`    ${renderField(field)}`);
    }
    lines.push('}');
    lines.push('');

    // Write type — omit readonly fields (use Input variants for sub-type refs);
    // extends ParentInput if parent has an Input variant, else extends parent read type
    const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
    const inputBase = model.base ? (modelsWithInput?.has(model.base) ? `${model.base}Input` : model.base) : undefined;
    if (inputBase) {
        lines.push(`export interface ${model.name}Input extends ${inputBase} {`);
    } else {
        lines.push(`export interface ${model.name}Input {`);
    }
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
