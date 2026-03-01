import { relative, dirname } from 'node:path';
import type { DtoRootNode, ModelNode, FieldNode } from './ast.js';
import type { DtoCodegenContext } from './codegen-dto.js';
import { collectExternalRefs, topoSortModels, resolveImportPath } from './codegen-dto.js';
import { renderTsType } from './codegen-sdk.js';

// ─── Public entry point ────────────────────────────────────────────────────

/**
 * Generate plain TypeScript interfaces/types from a DTO AST.
 * Unlike `generateDto()` which produces Zod schemas, this emits
 * vanilla TypeScript `interface` and `type` declarations suitable
 * for SDK consumers that don't need runtime validation.
 */
export function generatePlainTypes(root: DtoRootNode, context?: DtoCodegenContext): string {
    const externalRefs = collectExternalRefs(root);
    const lines: string[] = [];

    // Type-only imports for external references
    for (const ref of externalRefs) {
        const importPath = resolveImportPath(ref, context);
        lines.push(`import type { ${ref} } from '${importPath}';`);
    }
    if (externalRefs.length > 0) lines.push('');

    for (const model of topoSortModels(root.models)) {
        lines.push(...generateModel(model, context?.currentOutPath));
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(model: ModelNode, outPath?: string): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, outPath);
    }

    const hasVisibility = model.fields.some(f => f.visibility !== 'normal');

    if (hasVisibility) {
        return generateVisibilityModel(model, outPath);
    }
    return generateSimpleModel(model, outPath);
}

function generateComments(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push('/**');
    if (model.description) {
        lines.push(` * ${model.description}`);
    }

    const relPath = outPath ? relative(dirname(outPath), model.loc.file) : model.loc.file;
    lines.push(` * generated from [${model.name}](file://./${relPath}#L${model.loc.line})`);
    lines.push(' */');
    return lines;
}

function generateTypeAlias(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export type ${model.name} = ${renderTsType(model.type!)};`);
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

function generateVisibilityModel(model: ModelNode, outPath?: string): string[] {
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

    // Write type — omit readonly fields
    const writeFields = model.fields.filter(f => f.visibility !== 'readonly');
    const inputBase = model.base ? `${model.base}Input` : undefined;
    if (inputBase) {
        lines.push(`export interface ${model.name}Input extends ${inputBase} {`);
    } else {
        lines.push(`export interface ${model.name}Input {`);
    }
    for (const field of writeFields) {
        lines.push(`    ${renderField(field)}`);
    }
    lines.push('}');

    return lines;
}

// ─── Field rendering ──────────────────────────────────────────────────────

function renderField(field: FieldNode): string {
    const opt = field.optional || field.default !== undefined ? '?' : '';
    let typeStr = renderTsType(field.type);
    if (field.nullable) typeStr += ' | null';
    return `${field.name}${opt}: ${typeStr};`;
}
