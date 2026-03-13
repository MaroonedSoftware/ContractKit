import type {
    DtoRootNode,
    OpRootNode,
    DtoTypeNode,
    FieldNode,
    ModelNode,
    OpRouteNode,
    OpOperationNode,
    ParamSource,
    OpParamNode,
} from './ast.js';
import { resolveModifiers } from './ast.js';
import type { OpenApiConfig } from './config.js';

// ─── Public entry point ────────────────────────────────────────────────────

export interface OpenApiCodegenContext {
    dtoRoots: DtoRootNode[];
    opRoots: OpRootNode[];
    config: OpenApiConfig;
}

export function generateOpenApi(ctx: OpenApiCodegenContext): string {
    const { dtoRoots, opRoots, config } = ctx;

    const doc: Record<string, unknown> = {
        openapi: '3.1.0',
        info: {
            title: config.info?.title ?? 'API',
            version: config.info?.version ?? '0.0.1',
            ...(config.info?.description ? { description: config.info.description } : {}),
        },
    };

    if (config.servers && config.servers.length > 0) {
        doc.servers = config.servers;
    }

    if (config.security && config.security.length > 0) {
        doc.security = config.security;
    }

    // Build component schemas from all DTO models
    const schemas: Record<string, unknown> = {};
    const modelMap = new Map<string, ModelNode>();

    for (const dtoRoot of dtoRoots) {
        for (const model of dtoRoot.models) {
            modelMap.set(model.name, model);
            schemas[model.name] = modelToSchema(model);
        }
    }

    // Build paths from all operation files
    const paths: Record<string, Record<string, unknown>> = {};

    for (const opRoot of opRoots) {
        for (const route of opRoot.routes) {
            const oaPath = convertPath(route.path);

            for (const op of route.operations) {
                const mods = resolveModifiers(route, op);
                if (mods.includes('internal')) continue;
                // Lazily initialize the path object so all-internal routes
                // leave no empty entry in the output
                if (!paths[oaPath]) paths[oaPath] = {};
                const operation = buildOperation(route, op);
                if (mods.includes('deprecated')) (operation as Record<string, unknown>).deprecated = true;
                paths[oaPath][op.method] = operation;
            }
        }
    }

    doc.paths = paths;

    const components: Record<string, unknown> = {};
    if (Object.keys(schemas).length > 0) {
        components.schemas = schemas;
    }
    if (config.securitySchemes && Object.keys(config.securitySchemes).length > 0) {
        components.securitySchemes = config.securitySchemes;
    }
    if (Object.keys(components).length > 0) {
        doc.components = components;
    }

    return toYaml(doc);
}

// ─── Path conversion ──────────────────────────────────────────────────────

/** Convert Express-style `:param` to OpenAPI `{param}`. */
function convertPath(path: string): string {
    return path.replace(/:(\w+)/g, '{$1}');
}

// ─── Schema conversion ───────────────────────────────────────────────────

function modelToSchema(model: ModelNode): Record<string, unknown> {
    // Type alias (no fields)
    if (model.type) {
        const schema = typeToSchema(model.type);
        if (model.description) schema.description = model.description;
        return schema;
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of model.fields) {
        const prop = fieldToSchema(field);
        properties[field.name] = prop;
        if (!field.optional) {
            required.push(field.name);
        }
    }

    const schema: Record<string, unknown> = {
        type: 'object',
        properties,
    };

    if (required.length > 0) {
        schema.required = required;
    }

    if (model.base) {
        return {
            allOf: [
                { $ref: `#/components/schemas/${model.base}` },
                schema,
            ],
        };
    }

    if (model.description) {
        schema.description = model.description;
    }

    return schema;
}

function fieldToSchema(field: FieldNode): Record<string, unknown> {
    let schema = typeToSchema(field.type);

    if (field.nullable) {
        schema = wrapNullable(schema);
    }
    if (field.visibility === 'readonly') {
        schema.readOnly = true;
    } else if (field.visibility === 'writeonly') {
        schema.writeOnly = true;
    }
    if (field.default !== undefined) {
        schema.default = field.default;
    }
    if (field.description) {
        schema.description = field.description;
    }

    return schema;
}

function typeToSchema(type: DtoTypeNode): Record<string, unknown> {
    switch (type.kind) {
        case 'scalar':
            return scalarToSchema(type);
        case 'array':
            return arrayToSchema(type);
        case 'tuple':
            return { type: 'array', prefixItems: type.items.map(i => typeToSchema(i)) };
        case 'record':
            return { type: 'object', additionalProperties: typeToSchema(type.value) };
        case 'enum':
            return { type: 'string', enum: type.values };
        case 'literal':
            return { const: type.value };
        case 'union':
            return { oneOf: type.members.map(m => typeToSchema(m)) };
        case 'intersection':
            return { allOf: type.members.map(m => typeToSchema(m)) };
        case 'ref':
            return { $ref: `#/components/schemas/${type.name}` };
        case 'inlineObject':
            return inlineObjectToSchema(type.fields);
        case 'lazy':
            return typeToSchema(type.inner);
    }
}

function scalarToSchema(type: import('./ast.js').ScalarTypeNode): Record<string, unknown> {
    const s: Record<string, unknown> = {};

    switch (type.name) {
        case 'string':
            s.type = 'string';
            if (type.min !== undefined) s.minLength = Number(type.min);
            if (type.max !== undefined) s.maxLength = Number(type.max);
            if (type.len !== undefined) { s.minLength = type.len; s.maxLength = type.len; }
            if (type.regex) s.pattern = type.regex;
            break;
        case 'number':
            s.type = 'number';
            if (type.min !== undefined) s.minimum = Number(type.min);
            if (type.max !== undefined) s.maximum = Number(type.max);
            break;
        case 'int':
            s.type = 'integer';
            if (type.min !== undefined) s.minimum = Number(type.min);
            if (type.max !== undefined) s.maximum = Number(type.max);
            break;
        case 'bigint':
            s.type = 'integer';
            s.format = 'int64';
            break;
        case 'boolean':
            s.type = 'boolean';
            break;
        case 'date':
            s.type = 'string';
            s.format = 'date';
            break;
        case 'datetime':
            s.type = 'string';
            s.format = 'date-time';
            break;
        case 'email':
            s.type = 'string';
            s.format = 'email';
            break;
        case 'url':
            s.type = 'string';
            s.format = 'uri';
            break;
        case 'uuid':
            s.type = 'string';
            s.format = 'uuid';
            break;
        case 'any':
        case 'unknown':
            // No type constraint
            break;
        case 'null':
            s.type = 'null';
            break;
        case 'object':
            s.type = 'object';
            break;
        case 'binary':
            s.type = 'string';
            s.format = 'binary';
            break;
    }

    return s;
}

function arrayToSchema(type: import('./ast.js').ArrayTypeNode): Record<string, unknown> {
    const s: Record<string, unknown> = { type: 'array', items: typeToSchema(type.item) };
    if (type.min !== undefined) s.minItems = type.min;
    if (type.max !== undefined) s.maxItems = type.max;
    return s;
}

function inlineObjectToSchema(fields: FieldNode[]): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of fields) {
        properties[field.name] = fieldToSchema(field);
        if (!field.optional) {
            required.push(field.name);
        }
    }

    const schema: Record<string, unknown> = { type: 'object', properties };
    if (required.length > 0) schema.required = required;
    return schema;
}

function wrapNullable(schema: Record<string, unknown>): Record<string, unknown> {
    // OpenAPI 3.1 uses JSON Schema nullable via oneOf or type array
    if (schema.$ref) {
        return { oneOf: [schema, { type: 'null' }] };
    }
    if (typeof schema.type === 'string') {
        schema.type = [schema.type, 'null'];
    }
    return schema;
}

// ─── Operation building ─────────────────────────────────────────────────

function buildOperation(route: OpRouteNode, op: OpOperationNode): Record<string, unknown> {
    const operation: Record<string, unknown> = {};

    // operationId from service binding or SDK name
    if (op.sdk) {
        operation.operationId = op.sdk;
    } else if (op.service) {
        const methodPart = op.service.split('.').pop();
        if (methodPart) operation.operationId = methodPart;
    }

    if (op.description) {
        operation.description = op.description;
    }

    // Parameters: path params + query + headers
    const parameters: Record<string, unknown>[] = [];

    if (route.params) {
        parameters.push(...paramSourceToParams(route.params, 'path'));
    }
    if (op.query) {
        parameters.push(...paramSourceToParams(op.query, 'query'));
    }
    if (op.headers) {
        parameters.push(...paramSourceToParams(op.headers, 'header'));
    }

    if (parameters.length > 0) {
        operation.parameters = parameters;
    }

    // Request body
    if (op.request) {
        operation.requestBody = {
            required: true,
            content: {
                [op.request.contentType]: {
                    schema: typeToSchema(op.request.bodyType),
                },
            },
        };
    }

    // Operation-level security (overrides the global default from config)
    if (op.security) {
        if (op.security.length === 1 && op.security[0]!.name === 'none') {
            operation.security = [];  // explicit public endpoint — overrides global default
        } else {
            operation.security = op.security.map(s => ({ [s.name]: s.scopes }));
        }
    }

    // Responses
    const responses: Record<string, unknown> = {};
    for (const resp of op.responses) {
        const statusKey = String(resp.statusCode);
        if (resp.bodyType && resp.contentType) {
            responses[statusKey] = {
                description: statusDescription(resp.statusCode),
                content: {
                    [resp.contentType]: {
                        schema: typeToSchema(resp.bodyType),
                    },
                },
            };
        } else {
            responses[statusKey] = {
                description: statusDescription(resp.statusCode),
            };
        }
    }

    if (Object.keys(responses).length > 0) {
        operation.responses = responses;
    }

    return operation;
}

function paramSourceToParams(source: ParamSource, location: 'path' | 'query' | 'header'): Record<string, unknown>[] {
    if (typeof source === 'string') {
        // Type reference name used as param source — emit a single $ref
        // This is a model reference used for query/params; expand as a ref in content
        return [{
            name: source,
            in: location,
            required: location === 'path',
            schema: { $ref: `#/components/schemas/${source}` },
        }];
    }

    if (Array.isArray(source)) {
        // Inline param declarations
        return (source as OpParamNode[]).map(p => ({
            name: p.name,
            in: location,
            required: location === 'path',
            schema: typeToSchema(p.type),
        }));
    }

    // DtoTypeNode (inline object or other type) — if it's an inlineObject, expand fields
    if (source.kind === 'inlineObject') {
        return source.fields.map(f => ({
            name: f.name,
            in: location,
            required: location === 'path' ? true : !f.optional,
            schema: typeToSchema(f.type),
        }));
    }

    // For a ref type used as param source
    if (source.kind === 'ref') {
        return [{
            name: source.name,
            in: location,
            required: location === 'path',
            schema: { $ref: `#/components/schemas/${source.name}` },
        }];
    }

    return [];
}

function statusDescription(code: number): string {
    const descriptions: Record<number, string> = {
        200: 'Successful response',
        201: 'Created',
        204: 'No content',
        400: 'Bad request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not found',
        409: 'Conflict',
        422: 'Unprocessable entity',
        500: 'Internal server error',
    };
    return descriptions[code] ?? `Response ${code}`;
}

// ─── YAML serializer ──────────────────────────────────────────────────────

/**
 * Minimal YAML serializer sufficient for OpenAPI documents.
 * Avoids external dependency while producing clean, readable output.
 */
export function toYaml(value: unknown, indent = 0): string {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'bigint') return String(value);

    if (typeof value === 'string') {
        return yamlString(value);
    }

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';

        // Check if all items are simple scalars (for inline arrays like enum values, required lists)
        if (value.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
            const items = value.map(v => typeof v === 'string' ? yamlString(v) : String(v));
            const inline = `[${items.join(', ')}]`;
            if (inline.length < 80) return inline;
        }

        const lines: string[] = [];
        const pad = '  '.repeat(indent);
        for (const item of value) {
            if (isPlainObject(item)) {
                const entries = Object.entries(item as Record<string, unknown>);
                if (entries.length > 0) {
                    const [firstKey, firstVal] = entries[0]!;
                    const firstValStr = isComplex(firstVal)
                        ? `\n${toYamlValue(firstVal, indent + 2)}`
                        : ` ${toYaml(firstVal, indent + 2)}`;
                    lines.push(`${pad}- ${yamlKey(firstKey)}:${firstValStr}`);
                    for (let i = 1; i < entries.length; i++) {
                        const [k, v] = entries[i]!;
                        const valStr = isComplex(v)
                            ? `\n${toYamlValue(v, indent + 2)}`
                            : ` ${toYaml(v, indent + 2)}`;
                        lines.push(`${pad}  ${yamlKey(k)}:${valStr}`);
                    }
                } else {
                    lines.push(`${pad}- {}`);
                }
            } else {
                lines.push(`${pad}- ${toYaml(item, indent + 1)}`);
            }
        }
        return lines.join('\n');
    }

    if (isPlainObject(value)) {
        const obj = value as Record<string, unknown>;
        const entries = Object.entries(obj);
        if (entries.length === 0) return '{}';

        const pad = '  '.repeat(indent);
        const lines: string[] = [];
        for (const [key, val] of entries) {
            if (isComplex(val)) {
                lines.push(`${pad}${yamlKey(key)}:`);
                lines.push(toYamlValue(val, indent + 1));
            } else {
                lines.push(`${pad}${yamlKey(key)}: ${toYaml(val, indent + 1)}`);
            }
        }
        return lines.join('\n');
    }

    return String(value);
}

function toYamlValue(value: unknown, indent: number): string {
    if (Array.isArray(value)) {
        return toYaml(value, indent);
    }
    if (isPlainObject(value)) {
        return toYaml(value, indent);
    }
    return '  '.repeat(indent) + toYaml(value, indent);
}

function isComplex(value: unknown): boolean {
    if (Array.isArray(value)) {
        // Simple scalar arrays can be inlined
        if (value.every(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
            const items = value.map(v => typeof v === 'string' ? yamlString(v) : String(v));
            return `[${items.join(', ')}]`.length >= 80;
        }
        return true;
    }
    return isPlainObject(value);
}

function isPlainObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yamlString(s: string): string {
    // Use plain style if safe, otherwise single-quoted
    if (s === '') return "''";
    if (/^[\w./\-]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) && !/^\d/.test(s)) {
        return s;
    }
    // Single-quote, escaping internal single quotes by doubling
    return `'${s.replace(/'/g, "''")}'`;
}

function yamlKey(key: string): string {
    // Keys with special chars need quoting
    if (/^[\w\-]+$/.test(key) && !/^(true|false|null|yes|no|on|off)$/i.test(key)) {
        return key;
    }
    return `'${key.replace(/'/g, "''")}'`;
}
