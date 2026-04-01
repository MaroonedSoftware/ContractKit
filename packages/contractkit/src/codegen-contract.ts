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
    ModelRefTypeNode,
    InlineObjectTypeNode,
    IntersectionTypeNode,
    LazyTypeNode,
    ObjectMode,
} from './ast.js';

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

export interface ContractCodegenContext {
    /** Map from model name → absolute output file path */
    modelOutPaths: Map<string, string>;
    /** Absolute output file path for the current DTO file */
    currentOutPath: string;
    /** Set of model names that have Input variants (models with visibility modifiers) */
    modelsWithInput?: Set<string>;
    /** If set, import JsonValue from this path instead of re-declaring it (avoids barrel re-export conflicts) */
    jsonValueImportPath?: string;
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
            if (model.base) refs.add(model.base);
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
        lines.push(` * ${model.description}`);
    }

    const relPath = outPath ? relative(dirname(outPath), model.loc.file) : model.loc.file;
    lines.push(` * generated from [${model.name}](file://./${relPath}#L${model.loc.line})`);
    lines.push('*/');
    return lines;
}

export function generateContract(root: ContractRootNode, context?: ContractCodegenContext): string {
    const needsDateTime = rootNeedsDateTime(root);
    const needsBinary = rootNeedsScalar(root, 'binary');
    const needsDatetime = rootNeedsScalar(root, 'datetime');
    const needsJson = rootNeedsScalar(root, 'json');
    const externalRefs = collectExternalRefs(root);
    const lines: string[] = [];

    // Compute which models have Input variants (local, incl. transitive deps + external)
    const externalModelsWithInput = context?.modelsWithInput ?? new Set<string>();
    const localModelsWithInput = computeModelsWithInput(root.models, externalModelsWithInput);
    const allModelsWithInput = new Set([...localModelsWithInput, ...externalModelsWithInput]);

    // Collect additional external Input refs needed for Input schema fields
    const externalInputRefs = allModelsWithInput.size > 0 ? collectExternalInputRefs(root, allModelsWithInput) : [];
    const allExternalRefs = [...new Set([...externalRefs, ...externalInputRefs])].sort();

    lines.push(`import { z } from 'zod';`);
    if (needsDateTime) lines.push(`import { DateTime } from 'luxon';`);
    for (const ref of allExternalRefs) {
        const importPath = resolveImportPath(ref, context);
        lines.push(`import { ${ref} } from '${importPath}';`);
    }
    lines.push('');
    if (needsBinary) {
        lines.push(`const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });`);
    }
    if (needsDatetime) {
        lines.push(
            `const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));`,
        );
    }
    if (needsJson) {
        lines.push(`type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };`);
        lines.push(
            `const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));`,
        );
    }
    if (needsBinary || needsDatetime || needsJson) lines.push('');

    const modelsWithWriteonly = new Set(root.models.filter(m => m.fields.some(f => f.visibility === 'writeonly')).map(m => m.name));

    for (const model of topoSortModels(root.models)) {
        lines.push(...generateModel(model, context?.currentOutPath, allModelsWithInput, modelsWithWriteonly));
        lines.push('');
    }

    return lines.join('\n');
}

// ─── Model ─────────────────────────────────────────────────────────────────

function generateModel(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>, modelsWithWriteonly?: Set<string>): string[] {
    // Type alias: Name : typeExpression
    if (model.type) {
        return generateTypeAlias(model, outPath, modelsWithInput);
    }

    // A model needs Input/read split if it has visibility-modified fields OR if it
    // transitively references models that have Input variants (captured in modelsWithInput).
    const needsInputSplit = model.fields.some(f => f.visibility !== 'normal') || (modelsWithInput?.has(model.name) ?? false);

    if (needsInputSplit) {
        return generateThreeSchemaModel(model, outPath, modelsWithInput, modelsWithWriteonly);
    }
    return generateSimpleModel(model, outPath);
}

function generateTypeAlias(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));
    lines.push(`export const ${model.name} = ${renderType(model.type!)};`);
    lines.push(`export type ${model.name} = z.infer<typeof ${model.name}>;`);
    if (modelsWithInput?.has(model.name)) {
        lines.push(`export const ${model.name}Input = ${renderInputType(model.type!, modelsWithInput)};`);
        lines.push(`export type ${model.name}Input = z.infer<typeof ${model.name}Input>;`);
    }
    return lines;
}

function generateSimpleModel(model: ModelNode, outPath?: string): string[] {
    const lines: string[] = [];
    lines.push(...generateComments(model, outPath));

    const wrapper = modeToWrapper(model.mode ?? 'strict');

    const { inputCase, outputCase } = model;
    const hasInputTransform = !!inputCase && inputCase !== 'camel';
    const hasOutputTransform = !!outputCase && outputCase !== 'camel';

    if (hasInputTransform || hasOutputTransform) {
        const inputBody =
            inputCase === 'snake'
                ? renderFieldsAsSnakeCase(model.fields, model.mode)
                : inputCase === 'pascal'
                  ? renderFieldsAsPascalCase(model.fields, model.mode)
                  : renderFields(model.fields, model.mode);
        lines.push(`export const ${model.name} = ${wrapper}({`);
        lines.push(...inputBody.map(l => `    ${l}`));
        lines.push(`}).transform(data => ({`);
        for (const field of model.fields) {
            const inputKey = applyCase(field.name, inputCase);
            const outputKey = applyCase(field.name, outputCase);
            lines.push(`    ${quoteKey(outputKey)}: data.${inputKey},`);
        }
        lines.push(`}));`);
        lines.push(`export type ${model.name} = z.output<typeof ${model.name}>;`);
        return lines;
    }

    const body = renderFields(model.fields, model.mode);
    if (model.base) {
        lines.push(`export const ${model.name} = ${model.base}.extend({`);
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

function generateThreeSchemaModel(model: ModelNode, outPath?: string, modelsWithInput?: Set<string>, modelsWithWriteonly?: Set<string>): string[] {
    const lines: string[] = [];
    const name = model.name;

    lines.push(...generateComments(model, outPath));

    const wrapper = modeToWrapper(model.mode ?? 'strict');

    const allFields = model.fields;
    const hasWriteonly = allFields.some(f => f.visibility === 'writeonly');

    // Base schema — all fields (used internally when a submodel extends this one).
    // Only needed when this model has writeonly fields; otherwise Base === Read.
    if (hasWriteonly) {
        const baseBody = renderFields(allFields, model.mode);
        // Use ParentBase.extend() only when parent actually has writeonly fields (and thus a Base schema).
        const baseParent = model.base ? (modelsWithWriteonly?.has(model.base) ? `${model.base}Base` : model.base) : null;
        if (baseParent) {
            lines.push(`const ${name}Base = ${baseParent}.extend({`);
        } else {
            lines.push(`const ${name}Base = ${wrapper}({`);
        }
        lines.push(...baseBody.map(l => `    ${l}`));
        lines.push(`});`);
        lines.push('');
    }

    // Read schema — omit writeonly fields; extends parent read schema
    const readFields = allFields.filter(f => f.visibility !== 'writeonly');
    const readBody = renderFields(readFields, model.mode);
    if (model.base) {
        lines.push(`export const ${name} = ${model.base}.extend({`);
    } else {
        lines.push(`export const ${name} = ${wrapper}({`);
    }
    lines.push(...readBody.map(l => `    ${l}`));
    lines.push(`});`);
    lines.push(`export type ${name} = z.infer<typeof ${name}>;`);
    lines.push('');

    // Write schema — omit readonly fields (use Input variants for sub-type refs);
    // extends ParentInput if parent has an Input variant, else extends parent read schema
    const writeFields = allFields.filter(f => f.visibility !== 'readonly');
    const writeBody = modelsWithInput ? renderInputFields(writeFields, modelsWithInput, model.mode) : renderFields(writeFields, model.mode);
    const writeBase = model.base ? (modelsWithInput?.has(model.base) ? `${model.base}Input` : model.base) : null;
    if (writeBase) {
        lines.push(`export const ${name}Input = ${writeBase}.extend({`);
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

function renderFieldsAsPascalCase(fields: FieldNode[], defaultMode?: ObjectMode): string[] {
    return fields.map(f => {
        const pascalKey = camelToPascal(f.name);
        let expr = renderType(f.type, 'pascal', defaultMode);
        if (f.default !== undefined) {
            if (f.nullable) expr += '.nullable()';
            const dv = typeof f.default === 'string' ? `"${escapeString(f.default)}"` : String(f.default);
            expr += `.default(${dv})`;
        } else if (f.optional) {
            expr += '.nullish()';
        } else if (f.nullable) {
            expr += '.nullable()';
        }
        if (f.description) expr += `.describe("${escapeString(f.description)}")`;
        return `${quoteKey(pascalKey)}: ${expr},`;
    });
}

function renderFieldsAsSnakeCase(fields: FieldNode[], defaultMode?: ObjectMode): string[] {
    return fields.map(f => {
        const snakeKey = camelToSnake(f.name);
        let expr = renderType(f.type, 'snake', defaultMode);
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
        return `${quoteKey(snakeKey)}: ${expr},`;
    });
}

function renderField(field: FieldNode, defaultMode?: ObjectMode): string[] {
    const lines: string[] = [];
    if (field.deprecated) lines.push('/** @deprecated */');

    let expr = renderType(field.type, undefined, defaultMode);

    if (field.nullable) expr += '.nullable()';
    if (field.default !== undefined) {
        const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
        expr += `.default(${dv})`;
    } else if (field.optional) {
        expr += '.optional()';
    }
    if (field.description) expr += `.describe("${escapeString(field.description)}")`;

    lines.push(`${quoteKey(field.name)}: ${expr},`);
    return lines;
}

// ─── Type rendering ────────────────────────────────────────────────────────

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
            let e = 'z.coerce.number()';
            if (s.min !== undefined) e += `.min(${s.min})`;
            if (s.max !== undefined) e += `.max(${s.max})`;
            return e;
        }
        case 'int': {
            let e = 'z.coerce.number().int()';
            if (s.min !== undefined) e += `.min(${s.min})`;
            if (s.max !== undefined) e += `.max(${s.max})`;
            return e;
        }
        case 'bigint': {
            let inner = 'z.bigint()';
            if (s.min !== undefined) inner += `.min(${s.min}n)`;
            if (s.max !== undefined) inner += `.max(${s.max}n)`;
            return `z.preprocess((val) => typeof val === 'string' ? BigInt(val.replace(/n$/, '')) : val, ${inner})`;
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
        default:
            return 'z.unknown()';
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
    const vals = e.values.map(v => `"${v}"`).join(', ');
    return `z.enum([${vals}])`;
}

function renderLiteral(l: LiteralTypeNode): string {
    if (typeof l.value === 'string') return `z.literal("${escapeString(l.value)}")`;
    return `z.literal(${l.value})`;
}

function renderUnion(u: UnionTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    return `z.union([${u.members.map(m => renderType(m, parseCaseTransform, defaultMode)).join(', ')}])`;
}

function renderIntersection(i: IntersectionTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    const [first, ...rest] = i.members;
    // When the pattern is ref & { inlineObject(s) }, use .extend() to produce a
    // single merged ZodObject. Using .and(z.strictObject) breaks because each
    // strict side rejects the other side's keys during intersection parsing.
    if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'inlineObject')) {
        const allFields = rest.flatMap(m => (m as InlineObjectTypeNode).fields);
        const fieldLines =
            parseCaseTransform === 'snake'
                ? renderFieldsAsSnakeCase(allFields, defaultMode)
                      .map(l => `    ${l}`)
                      .join('\n')
                : parseCaseTransform === 'pascal'
                  ? renderFieldsAsPascalCase(allFields, defaultMode)
                        .map(l => `    ${l}`)
                        .join('\n')
                  : allFields
                        .flatMap(f => renderField(f, defaultMode))
                        .map(l => `    ${l}`)
                        .join('\n');
        return `${first.name}.extend({\n${fieldLines}\n})`;
    }
    let expr = renderType(first!, parseCaseTransform, defaultMode);
    for (const member of rest) {
        expr += `.and(${renderType(member, parseCaseTransform, defaultMode)})`;
    }
    return expr;
}

function renderInlineObject(o: InlineObjectTypeNode, parseCaseTransform?: 'snake' | 'pascal', defaultMode?: ObjectMode): string {
    const wrapper = modeToWrapper(o.mode ?? defaultMode ?? 'strict');
    if (parseCaseTransform === 'snake') {
        const snakeLines = renderFieldsAsSnakeCase(o.fields, defaultMode);
        const joined = snakeLines.map(l => `    ${l}`).join('\n');
        const transformEntries = o.fields
            .map(f => {
                const snakeKey = camelToSnake(f.name);
                // Optional fields use .nullish() on input; coerce null → undefined in output
                const val = f.optional ? `data.${snakeKey} ?? undefined` : `data.${snakeKey}`;
                return `    ${quoteKey(f.name)}: ${val},`;
            })
            .join('\n');
        return `${wrapper}({\n${joined}\n}).transform(data => ({\n${transformEntries}\n}))`;
    }
    if (parseCaseTransform === 'pascal') {
        const pascalLines = renderFieldsAsPascalCase(o.fields, defaultMode);
        const joined = pascalLines.map(l => `    ${l}`).join('\n');
        const transformEntries = o.fields
            .map(f => {
                const pascalKey = camelToPascal(f.name);
                const val = f.optional ? `data.${pascalKey} ?? undefined` : `data.${pascalKey}`;
                return `    ${quoteKey(f.name)}: ${val},`;
            })
            .join('\n');
        return `${wrapper}({\n${joined}\n}).transform(data => ({\n${transformEntries}\n}))`;
    }
    const fields = o.fields
        .flatMap(f => renderField(f, defaultMode))
        .map(l => `    ${l}`)
        .join('\n');
    return `${wrapper}({\n${fields}\n})`;
}

// ─── Input type rendering ─────────────────────────────────────────────────

/**
 * Like renderScalar, but coerces from string input (JSON wire format).
 * Used for Input (write) schemas where data arrives as JSON strings.
 */
function renderInputScalar(s: ScalarTypeNode): string {
    return renderScalar(s);
}

/**
 * Like renderType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers, and coerces scalars from strings.
 * Used for Input (write) schema fields so that sub-type references also
 * point to their Input variants.
 */
export function renderInputType(type: ContractTypeNode, modelsWithInput?: Set<string>, defaultMode?: ObjectMode): string {
    switch (type.kind) {
        case 'scalar':
            return renderInputScalar(type);
        case 'ref':
            return modelsWithInput?.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            let e = `z.array(${renderInputType(type.item, modelsWithInput, defaultMode)})`;
            if (type.min !== undefined) e += `.min(${type.min})`;
            if (type.max !== undefined) e += `.max(${type.max})`;
            return e;
        }
        case 'tuple':
            return `z.tuple([${type.items.map(i => renderInputType(i, modelsWithInput, defaultMode)).join(', ')}])`;
        case 'record':
            return `z.record(${renderInputType(type.key, modelsWithInput, defaultMode)}, ${renderInputType(type.value, modelsWithInput, defaultMode)})`;
        case 'union':
            return `z.union([${type.members.map(m => renderInputType(m, modelsWithInput, defaultMode)).join(', ')}])`;
        case 'intersection': {
            const [first, ...rest] = type.members;
            if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'inlineObject')) {
                const base = modelsWithInput?.has(first.name) ? `${first.name}Input` : first.name;
                const allFields = rest.flatMap(m => (m as InlineObjectTypeNode).fields);
                const fieldLines = allFields.map(f => `    ${renderInputField(f, modelsWithInput ?? new Set(), defaultMode)}`).join('\n');
                return `${base}.extend({\n${fieldLines}\n})`;
            }
            let expr = renderInputType(first!, modelsWithInput, defaultMode);
            for (const member of rest) {
                expr += `.and(${renderInputType(member, modelsWithInput, defaultMode)})`;
            }
            return expr;
        }
        case 'lazy':
            return `z.lazy(() => ${renderInputType(type.inner, modelsWithInput, defaultMode)})`;
        case 'inlineObject': {
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

    let expr = renderInputType(field.type, modelsWithInput, defaultMode);

    if (field.nullable) expr += '.nullable()';
    if (field.default !== undefined) {
        const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
        expr += `.default(${dv})`;
    } else if (field.optional) {
        expr += '.optional()';
    }
    if (field.description) expr += `.describe("${escapeString(field.description)}")`;

    lines.push(`${quoteKey(field.name)}: ${expr},`);
    return lines;
}

function renderInputFields(fields: FieldNode[], modelsWithInput: Set<string>, defaultMode?: ObjectMode): string[] {
    return fields.flatMap(f => renderInputField(f, modelsWithInput, defaultMode));
}

// ─── Query type rendering ─────────────────────────────────────────────────

/**
 * Like renderType, but wraps array types with z.preprocess to handle
 * query strings where a single value arrives as a string instead of a string[].
 * Also uses Input variants for model refs when modelsWithInput is provided.
 */
export function renderQueryType(type: ContractTypeNode, modelsWithInput?: Set<string>, defaultMode?: ObjectMode): string {
    switch (type.kind) {
        case 'array': {
            const inner = modelsWithInput ? renderInputType(type, modelsWithInput, defaultMode) : renderType(type, undefined, defaultMode);
            return `z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, ${inner})`;
        }
        case 'inlineObject': {
            const fields = type.fields.map(f => `    ${renderQueryField(f, modelsWithInput, defaultMode)}`).join('\n');
            return `${modeToWrapper(type.mode ?? defaultMode ?? 'strict')}({\n${fields}\n})`;
        }
        case 'intersection': {
            const [first, ...rest] = type.members;
            if (first && first.kind === 'ref' && rest.length > 0 && rest.every(m => m.kind === 'inlineObject')) {
                const base = modelsWithInput?.has(first.name) ? `${first.name}Input` : first.name;
                const allFields = rest.flatMap(m => (m as InlineObjectTypeNode).fields);
                const fieldLines = allFields.map(f => `    ${renderQueryField(f, modelsWithInput, defaultMode)}`).join('\n');
                return `${base}.extend({\n${fieldLines}\n})`;
            }
            let expr = renderQueryType(first!, modelsWithInput, defaultMode);
            for (const member of rest) {
                expr += `.and(${renderQueryType(member, modelsWithInput, defaultMode)})`;
            }
            return expr;
        }
        case 'ref':
            return modelsWithInput?.has(type.name) ? `${type.name}Input` : type.name;
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

    if (field.nullable) expr += '.nullable()';
    if (field.default !== undefined) {
        const dv = typeof field.default === 'string' ? `"${escapeString(field.default)}"` : String(field.default);
        expr += `.default(${dv})`;
    } else if (field.optional) {
        expr += '.optional()';
    }
    if (field.description) expr += `.describe("${escapeString(field.description)}")`;

    return `${quoteKey(field.name)}: ${expr},`;
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

export function rootNeedsScalar(root: ContractRootNode, name: string): boolean {
    return root.models.some(m => (m.type && typeNeedsScalar(m.type, name)) || m.fields.some(f => typeNeedsScalar(f.type, name)));
}

export function typeNeedsDateTime(type: ContractTypeNode): boolean {
    switch (type.kind) {
        case 'scalar':
            return type.name === 'date' || type.name === 'time' || type.name === 'datetime';
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

export function collectExternalRefs(root: ContractRootNode): string[] {
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
        // When a model extends an external parent that has an Input variant,
        // the write schema extends ParentInput — so we need to import it.
        if (model.base && modelsWithInput.has(model.base) && !localNames.has(model.base)) {
            refs.add(`${model.base}Input`);
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

export function collectTypeRefs(type: ContractTypeNode, out: Set<string>): void {
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
export function topoSortModels(models: ModelNode[]): ModelNode[] {
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
