import { relative, dirname } from 'node:path';
import type {
    DtoRootNode,
    ModelNode,
    FieldNode,
    DtoTypeNode,
    ScalarTypeNode,
    ArrayTypeNode,
    TupleTypeNode,
    RecordTypeNode,
    EnumTypeNode,
    LiteralTypeNode,
    UnionTypeNode,
    ModelRefTypeNode,
    InlineObjectTypeNode,
    IntersectionTypeNode,
    LazyTypeNode,
} from './ast.js';

// ─── Cross-file import resolution ─────────────────────────────────────────

export interface DtoCodegenContext {
    /** Map from model name → absolute output file path */
    modelOutPaths: Map<string, string>;
    /** Absolute output file path for the current DTO file */
    currentOutPath: string;
}

// ─── Public entry point ────────────────────────────────────────────────────

function generateComments(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push('/**');
    if (model.description) {
        lines.push(` * ${model.description}`);
    }

    const relPath = outPath ? relative(dirname(outPath), model.loc.file) : model.loc.file;
    lines.push(` * generated from [${model.name}](file://./${relPath}#L${model.loc.line})`);
    lines.push('*/');
    return lines;
}

export function generateDto(root: DtoRootNode, context?: DtoCodegenContext): string {
    const needsDateTime = rootNeedsDateTime(root);
    const externalRefs = collectExternalRefs(root);
    const lines: string[] = [];

    lines.push(`import { z } from 'zod';`);
    if (needsDateTime) lines.push(`import { DateTime } from 'luxon';`);
    for (const ref of externalRefs) {
        const importPath = resolveImportPath(ref, context);
        lines.push(`import { ${ref} } from '${importPath}';`);
    }
    lines.push('');

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
        return generateThreeSchemaModel(model, outPath);
    }
    return generateSimpleModel(model, outPath);
}

function generateTypeAlias(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export const ${model.name} = ${renderType(model.type!)};`);
    lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
    return lines;
}

function generateSimpleModel(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const body = renderFields(model.fields);

    if (model.base) {
        lines.push(`export const ${model.name} = ${model.base}.extend({`);
        lines.push(...body.map(l => `    ${l}`));
        lines.push(`});`);
    } else {
        lines.push(`export const ${model.name} = z.strictObject({`);
        lines.push(...body.map(l => `    ${l}`));
        lines.push(`});`);
    }

    lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
    return lines;
}

function generateThreeSchemaModel(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    const name = model.name;

    lines.push(...generateComments(model, outPath));

    // Base schema — all fields
    const allFields = model.fields;
    const baseBody = renderFields(allFields);

    if (model.base) {
        lines.push(`const ${name}Base = ${model.base}Base.extend({`);
    } else {
        lines.push(`const ${name}Base = z.strictObject({`);
    }
    lines.push(...baseBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push('');

    // Read schema — omit writeonly fields
    const readFields = allFields.filter(f => f.visibility !== 'writeonly');
    const readBody = renderFields(readFields);
    lines.push(`export const ${name} = z.strictObject({`);
    lines.push(...readBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}>;`);
    lines.push('');

    // Write schema — omit readonly fields
    const writeFields = allFields.filter(f => f.visibility !== 'readonly');
    const writeBody = renderFields(writeFields);
    lines.push(`export const ${name}Input = z.strictObject({`);
    lines.push(...writeBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push(`export type ${name}Input = z.infer<typeof ${name}Input>;`);

    return lines;
}

// ─── Fields ────────────────────────────────────────────────────────────────

function renderFields(fields: FieldNode[]): string[] {
    return fields.map(f => renderField(f));
}

function renderField(field: FieldNode): string {
    let expr = renderType(field.type);

    if (field.nullable) expr += '.nullable()';
    if (field.default !== undefined) {
        const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
        expr += `.default(${dv})`;
    } else if (field.optional) {
        expr += '.optional()';
    }
    if (field.description) expr += `.describe("${escapeString(field.description)}")`;

    return `${field.name}: ${expr},`;
}

// ─── Type rendering ────────────────────────────────────────────────────────

export function renderType(type: DtoTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderScalar(type);
        case 'array':
            return renderArray(type);
        case 'tuple':
            return renderTuple(type);
        case 'record':
            return renderRecord(type);
        case 'enum':
            return renderEnum(type);
        case 'literal':
            return renderLiteral(type);
        case 'union':
            return renderUnion(type);
        case 'intersection':
            return renderIntersection(type);
        case 'ref':
            return type.name;
        case 'lazy':
            return `z.lazy(() => ${renderType(type.inner)})`;
        case 'inlineObject':
            return renderInlineObject(type);
        default:
            return 'z.unknown()';
    }
}

function renderScalar(s: ScalarTypeNode): string {
    switch (s.name) {
        case 'string': {
            let e = 'z.string()';
            if (s.min !== undefined && s.max !== undefined) e += `.min(${s.min}).max(${s.max})`;
            else if (s.min !== undefined) e += `.min(${s.min})`;
            else if (s.max !== undefined) e += `.max(${s.max})`;
            if (s.len !== undefined) e += `.length(${s.len})`;
            if (s.regex) e += `.regex(/^${s.regex.replace(/\//g, '\\/')}$/)`;
            return e;
        }
        case 'number': {
            let e = 'z.number()';
            if (s.min !== undefined) e += `.min(${s.min})`;
            if (s.max !== undefined) e += `.max(${s.max})`;
            return e;
        }
        case 'int': {
            let e = 'z.int()';
            if (s.min !== undefined) e += `.min(${s.min})`;
            if (s.max !== undefined) e += `.max(${s.max})`;
            return e;
        }
        case 'bigint': {
            let e = 'z.bigint()';
            if (s.min !== undefined) e += `.min(${s.min}n)`;
            if (s.max !== undefined) e += `.max(${s.max}n)`;
            return e;
        }
        case 'boolean':
            return 'z.boolean()';
        case 'date':
        case 'datetime':
            return `z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be in ISO 8601 format' })`;
        case 'email':
            return 'z.email()';
        case 'url':
            return 'z.url()';
        case 'uuid':
            return 'z.uuid()';
        case 'any':
            return 'z.any()';
        case 'unknown':
            return 'z.unknown()';
        case 'null':
            return 'z.null()';
        case 'object':
            return 'z.record(z.string(), z.unknown())';
        case 'binary':
            return "z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' })";
        default:
            return 'z.unknown()';
    }
}

function renderArray(a: ArrayTypeNode): string {
    let e = `z.array(${renderType(a.item)})`;
    if (a.min !== undefined) e += `.min(${a.min})`;
    if (a.max !== undefined) e += `.max(${a.max})`;
    return e;
}

function renderTuple(t: TupleTypeNode): string {
    return `z.tuple([${t.items.map(renderType).join(', ')}])`;
}

function renderRecord(r: RecordTypeNode): string {
    return `z.record(${renderType(r.key)}, ${renderType(r.value)})`;
}

function renderEnum(e: EnumTypeNode): string {
    const vals = e.values.map(v => `"${v}"`).join(', ');
    return `z.enum([${vals}])`;
}

function renderLiteral(l: LiteralTypeNode): string {
    if (typeof l.value === 'string') return `z.literal("${escapeString(l.value)}")`;
    return `z.literal(${l.value})`;
}

function renderUnion(u: UnionTypeNode): string {
    return `z.union([${u.members.map(renderType).join(', ')}])`;
}

function renderIntersection(i: IntersectionTypeNode): string {
    const [first, ...rest] = i.members;
    let expr = renderType(first!);
    for (const member of rest) {
        expr += `.and(${renderType(member)})`;
    }
    return expr;
}

function renderInlineObject(o: InlineObjectTypeNode): string {
    const fields = o.fields.map(f => `    ${renderField(f)}`).join('\n');
    return `z.strictObject({\n${fields}\n})`;
}

// ─── String escaping ──────────────────────────────────────────────────────

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function rootNeedsDateTime(root: DtoRootNode): boolean {
    return root.models.some(m => (m.type && typeNeedsDateTime(m.type)) || m.fields.some(f => typeNeedsDateTime(f.type)));
}

function typeNeedsDateTime(type: DtoTypeNode): boolean {
    switch (type.kind) {
        case 'scalar':
            return type.name === 'date' || type.name === 'datetime';
        case 'array':
            return typeNeedsDateTime(type.item);
        case 'union':
            return type.members.some(typeNeedsDateTime);
        case 'intersection':
            return type.members.some(typeNeedsDateTime);
        case 'inlineObject':
            return type.fields.some(f => typeNeedsDateTime(f.type));
        default:
            return false;
    }
}

function collectExternalRefs(root: DtoRootNode): string[] {
    const localNames = new Set(root.models.map(m => m.name));
    const refs = new Set<string>();

    for (const model of root.models) {
        if (model.base && !localNames.has(model.base)) refs.add(model.base);
        if (model.type) collectTypeRefs(model.type, refs);
        for (const field of model.fields) {
            collectTypeRefs(field.type, refs);
        }
    }

    for (const name of localNames) refs.delete(name);
    return [...refs].sort();
}

function collectTypeRefs(type: DtoTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            out.add(type.name);
            break;
        case 'array':
            collectTypeRefs(type.item, out);
            break;
        case 'tuple':
            type.items.forEach(t => collectTypeRefs(t, out));
            break;
        case 'record':
            collectTypeRefs(type.key, out);
            collectTypeRefs(type.value, out);
            break;
        case 'union':
            type.members.forEach(t => collectTypeRefs(t, out));
            break;
        case 'intersection':
            type.members.forEach(t => collectTypeRefs(t, out));
            break;
        case 'lazy':
            collectTypeRefs(type.inner, out);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectTypeRefs(f.type, out));
            break;
    }
}

/**
 * Topologically sort models so dependencies are emitted before dependents.
 * Falls back to source order for cycles (which would need z.lazy at runtime).
 */
function topoSortModels(models: ModelNode[]): ModelNode[] {
    const localNames = new Set(models.map(m => m.name));
    const modelMap = new Map(models.map(m => [m.name, m]));

    // Build adjacency: model name → set of local model names it depends on
    const deps = new Map<string, Set<string>>();
    for (const model of models) {
        const refs = new Set<string>();
        if (model.base && localNames.has(model.base)) refs.add(model.base);
        if (model.type) collectTypeRefs(model.type, refs);
        for (const field of model.fields) {
            collectTypeRefs(field.type, refs);
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
function resolveImportPath(refName: string, context?: DtoCodegenContext): string {
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
