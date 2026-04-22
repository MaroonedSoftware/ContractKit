import type {
    CkRootNode,
    ModelNode,
    FieldNode,
    ContractTypeNode,
    OpRouteNode,
    OpOperationNode,
    OpRequestNode,
    OpResponseNode,
    ParamSource,
    SecurityNode,
    SecurityFields,
    ObjectMode,
    RouteModifier,
} from '@maroonedsoftware/contractkit';

const INDENT = '    '; // 4 spaces

// ─── Public API ───────────────────────────────────────────────────────────

export interface SerializeOptions {
    /** Emit descriptions as inline # comments. Default: true. */
    includeComments?: boolean;
}

export function astToCk(root: CkRootNode, options: SerializeOptions = {}): string {
    const { includeComments = true } = options;
    const ctx: Ctx = { includeComments };
    const parts: string[] = [];

    // Options block
    const optionsBlock = serializeOptions(root);
    if (optionsBlock) parts.push(optionsBlock);

    // Models
    for (const model of root.models) {
        parts.push(serializeModel(model, ctx));
    }

    // Routes
    for (const route of root.routes) {
        parts.push(serializeRoute(route, ctx));
    }

    return parts.join('\n\n') + '\n';
}

// ─── Context ──────────────────────────────────────────────────────────────

interface Ctx {
    includeComments: boolean;
}

// ─── Options block ────────────────────────────────────────────────────────

function serializeOptions(root: CkRootNode): string | null {
    const hasKeys = Object.keys(root.meta).length > 0;
    const hasServices = root.services && Object.keys(root.services).length > 0;
    const hasSecurity = root.security !== undefined;

    if (!hasKeys && !hasServices && !hasSecurity) return null;

    const lines: string[] = ['options {'];

    if (hasKeys) {
        lines.push(`${INDENT}keys: {`);
        for (const [key, value] of Object.entries(root.meta)) {
            lines.push(`${INDENT}${INDENT}${key}: ${value}`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasServices) {
        lines.push(`${INDENT}services: {`);
        for (const [name, path] of Object.entries(root.services)) {
            lines.push(`${INDENT}${INDENT}${name}: "${path}"`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasSecurity) {
        lines.push(`${INDENT}security: {`);
        if (root.security === 'none') {
            lines.push(`${INDENT}${INDENT}none`);
        } else {
            const sec = root.security as SecurityFields;
            if (sec.roles && sec.roles.length > 0) {
                lines.push(`${INDENT}${INDENT}roles: [${sec.roles.join(', ')}]`);
            }
        }
        lines.push(`${INDENT}}`);
    }

    lines.push('}');
    return lines.join('\n');
}

// ─── Models ───────────────────────────────────────────────────────────────

function serializeModel(model: ModelNode, ctx: Ctx): string {
    const parts: string[] = [];

    // Modifiers: format(input=snake) mode(loose) deprecated
    const prefixes: string[] = [];
    if (model.inputCase && model.inputCase !== 'camel') {
        prefixes.push(`format(input=${model.inputCase})`);
    }
    if (model.mode && model.mode !== 'strict') {
        prefixes.push(`mode(${model.mode})`);
    }
    if (model.deprecated) {
        prefixes.push('deprecated');
    }

    const prefix = prefixes.length > 0 ? prefixes.join(' ') + ' ' : '';
    const comment = ctx.includeComments && model.description ? ` # ${model.description}` : '';

    // Type alias: contract Name: typeExpression
    if (model.type) {
        parts.push(`contract ${prefix}${model.name}: ${serializeType(model.type)}${comment}`);
        return parts.join('');
    }

    // Inheritance: contract Name: Base & { ... }
    if (model.base) {
        parts.push(`contract ${prefix}${model.name}: ${model.base} & {${comment}`);
    } else {
        parts.push(`contract ${prefix}${model.name}: {${comment}`);
    }

    for (const field of model.fields) {
        parts.push(serializeField(field, 1, ctx));
    }

    parts.push('}');
    return parts.join('\n');
}

function serializeField(field: FieldNode, depth: number, ctx: Ctx): string {
    const indent = INDENT.repeat(depth);
    const optional = field.optional ? '?' : '';
    const visibility = field.visibility !== 'normal' ? `${field.visibility} ` : '';
    const deprecated = field.deprecated ? 'deprecated ' : '';

    let typeStr = serializeType(field.type);

    // Nullable fields: if the type doesn't already contain null, append `| null`
    if (field.nullable && !typeContainsNull(field.type)) {
        typeStr = `${typeStr} | null`;
    }

    const defaultVal = field.default !== undefined ? ` = ${serializeDefault(field.default)}` : '';
    const comment = ctx.includeComments && field.description ? ` # ${field.description}` : '';

    return `${indent}${field.name}${optional}: ${deprecated}${visibility}${typeStr}${defaultVal}${comment}`;
}

function typeContainsNull(type: ContractTypeNode): boolean {
    if (type.kind === 'scalar' && type.name === 'null') return true;
    if (type.kind === 'union') return type.members.some(typeContainsNull);
    return false;
}

function serializeDefault(value: string | number | boolean): string {
    if (typeof value === 'string') {
        // If it looks like an identifier (e.g. enum value), don't quote it
        if (/^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(value)) return value;
        return `"${value}"`;
    }
    return String(value);
}

// ─── Types ────────────────────────────────────────────────────────────────

export function serializeType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return serializeScalar(type);
        case 'array':
            return serializeArray(type);
        case 'tuple':
            return `tuple(${type.items.map(serializeType).join(', ')})`;
        case 'record':
            return `record(${serializeType(type.key)}, ${serializeType(type.value)})`;
        case 'enum':
            return `enum(${type.values.join(', ')})`;
        case 'literal':
            return serializeLiteral(type);
        case 'union':
            return type.members.map(serializeType).join(' | ');
        case 'intersection':
            return type.members.map(serializeType).join(' & ');
        case 'ref':
            return type.name;
        case 'inlineObject':
            return serializeInlineObject(type);
        case 'lazy':
            return `lazy(${serializeType(type.inner)})`;
    }
}

function serializeScalar(type: {
    name: string;
    min?: number | bigint | string;
    max?: number | bigint | string;
    len?: number;
    regex?: string;
    format?: string;
}): string {
    const args: string[] = [];
    if (type.len !== undefined) args.push(`length=${type.len}`);
    if (type.min !== undefined) args.push(typeof type.min === 'string' ? `min="${type.min}"` : `min=${type.min}`);
    if (type.max !== undefined) args.push(typeof type.max === 'string' ? `max="${type.max}"` : `max=${type.max}`);
    if (type.regex !== undefined) args.push(`regex=${type.regex}`);
    if (type.format !== undefined) args.push(`format=${type.format}`);

    if (args.length === 0) return type.name;
    return `${type.name}(${args.join(', ')})`;
}

function serializeArray(type: { item: ContractTypeNode; min?: number; max?: number }): string {
    const args: string[] = [serializeType(type.item)];
    if (type.min !== undefined) args.push(`min=${type.min}`);
    if (type.max !== undefined) args.push(`max=${type.max}`);
    return `array(${args.join(', ')})`;
}

function serializeLiteral(type: { value: string | number | boolean }): string {
    if (typeof type.value === 'string') return `literal("${type.value}")`;
    return `literal(${type.value})`;
}

function serializeInlineObject(type: { fields: FieldNode[]; mode?: ObjectMode }): string {
    const modePrefix = type.mode ? `mode(${type.mode}) ` : '';
    if (type.fields.length === 0) return `${modePrefix}{}`;

    const lines: string[] = [`${modePrefix}{`];
    for (const field of type.fields) {
        lines.push(serializeField(field, 2, { includeComments: true }));
    }
    lines.push(`${INDENT}}`);
    return lines.join('\n');
}

// ─── Routes ───────────────────────────────────────────────────────────────

function serializeRoute(route: OpRouteNode, ctx: Ctx): string {
    const lines: string[] = [];

    const modStr = serializeModifiers(route.modifiers);
    const comment = ctx.includeComments && route.description ? ` # ${route.description}` : '';
    lines.push(`operation${modStr} ${route.path}: {${comment}`);

    // Route-level params
    if (route.params) {
        serializeParamSource(lines, 'params', route.params, route.paramsMode, 1, ctx);
    }

    // Route-level security
    if (route.security !== undefined) {
        serializeSecurityBlock(lines, route.security, 1, ctx);
    }

    // Operations
    for (const op of route.operations) {
        serializeOperation(lines, op, 1, ctx);
    }

    lines.push('}');
    return lines.join('\n');
}

function serializeOperation(lines: string[], op: OpOperationNode, depth: number, ctx: Ctx): string[] {
    const indent = INDENT.repeat(depth);
    const modStr = serializeModifiers(op.modifiers);
    const comment = ctx.includeComments && op.description ? ` # ${op.description}` : '';
    lines.push(`${indent}${op.method}${modStr}: {${comment}`);

    const inner = INDENT.repeat(depth + 1);

    // Service
    if (op.service) {
        lines.push(`${inner}service: ${op.service}`);
    }

    // SDK
    if (op.sdk) {
        lines.push(`${inner}sdk: ${op.sdk}`);
    }

    // Signature
    if (op.signature) {
        const sigComment = ctx.includeComments && op.signatureDescription ? ` # ${op.signatureDescription}` : '';
        lines.push(`${inner}signature: ${op.signature}${sigComment}`);
    }

    // Security
    if (op.security !== undefined) {
        serializeSecurityBlock(lines, op.security, depth + 1, ctx);
    }

    // Query
    if (op.query) {
        serializeParamSource(lines, 'query', op.query, op.queryMode, depth + 1, ctx);
    }

    // Headers
    if (op.headers) {
        serializeParamSource(lines, 'headers', op.headers, op.headersMode, depth + 1, ctx);
    }

    // Request
    if (op.request) {
        serializeRequest(lines, op.request, depth + 1);
    }

    // Responses
    if (op.responses.length > 0) {
        serializeResponses(lines, op.responses, depth + 1);
    }

    lines.push(`${indent}}`);
    return lines;
}

function serializeModifiers(modifiers?: RouteModifier[]): string {
    if (!modifiers || modifiers.length === 0) return '';
    return `(${modifiers.join(', ')})`;
}

function serializeParamSource(lines: string[], keyword: string, source: ParamSource, mode: ObjectMode | undefined, depth: number, ctx: Ctx): void {
    const indent = INDENT.repeat(depth);

    // String reference: `query: TypeName`
    if (source.kind === 'ref') {
        lines.push(`${indent}${keyword}: ${source.name}`);
        return;
    }

    // ContractTypeNode reference
    if (source.kind === 'type') {
        lines.push(`${indent}${keyword}: ${serializeType(source.node)}`);
        return;
    }

    // Inline param declarations: `params: { name: type }`
    const modeStr = mode ? `mode(${mode}) ` : '';
    lines.push(`${indent}${keyword}: ${modeStr}{`);
    for (const param of source.nodes) {
        const optional = param.optional ? '?' : '';
        let typeStr = serializeType(param.type);
        if (param.nullable && !typeContainsNull(param.type)) {
            typeStr = `${typeStr} | null`;
        }
        const defaultVal = param.default !== undefined ? ` = ${serializeDefault(param.default)}` : '';
        const comment = ctx.includeComments && param.description ? ` # ${param.description}` : '';
        lines.push(`${INDENT.repeat(depth + 1)}${param.name}${optional}: ${typeStr}${defaultVal}${comment}`);
    }
    lines.push(`${indent}}`);
}

function serializeRequest(lines: string[], request: OpRequestNode, depth: number): void {
    const indent = INDENT.repeat(depth);
    lines.push(`${indent}request: {`);
    lines.push(`${INDENT.repeat(depth + 1)}${request.contentType}: ${serializeType(request.bodyType)}`);
    lines.push(`${indent}}`);
}

function serializeResponses(lines: string[], responses: OpResponseNode[], depth: number): void {
    const indent = INDENT.repeat(depth);
    lines.push(`${indent}response: {`);
    for (const resp of responses) {
        if (resp.bodyType && resp.contentType) {
            lines.push(`${INDENT.repeat(depth + 1)}${resp.statusCode}: {`);
            lines.push(`${INDENT.repeat(depth + 2)}${resp.contentType}: ${serializeType(resp.bodyType)}`);
            lines.push(`${INDENT.repeat(depth + 1)}}`);
        } else {
            lines.push(`${INDENT.repeat(depth + 1)}${resp.statusCode}:`);
        }
    }
    lines.push(`${indent}}`);
}

function serializeSecurityBlock(lines: string[], security: SecurityNode, depth: number, ctx: Ctx): void {
    const indent = INDENT.repeat(depth);
    if (security === 'none') {
        lines.push(`${indent}security: none`);
        return;
    }

    const sec = security as SecurityFields;
    if (sec.roles && sec.roles.length > 0) {
        const rolesComment = ctx.includeComments && sec.rolesDescription ? ` # ${sec.rolesDescription}` : '';
        lines.push(`${indent}security: {`);
        lines.push(`${INDENT.repeat(depth + 1)}roles: [${sec.roles.join(', ')}]${rolesComment}`);
        lines.push(`${indent}}`);
    } else {
        lines.push(`${indent}security: {}`);
    }
}
