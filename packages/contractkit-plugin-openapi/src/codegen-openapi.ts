import type {
    ContractRootNode,
    OpRootNode,
    ContractTypeNode,
    FieldNode,
    ModelNode,
    OpRouteNode,
    OpOperationNode,
    ParamSource,
} from '@contractkit/core';
import { resolveModifiers, resolveSecurity, SECURITY_NONE } from '@contractkit/core';

export interface OpenApiServerEntry {
    url: string;
    description?: string;
}

export interface OpenApiSecurityScheme {
    type: string;
    scheme?: string;
    bearerFormat?: string;
    name?: string;
    in?: string;
}

export interface OpenApiConfig {
    baseDir?: string;
    output?: string;
    info?: {
        title?: string;
        version?: string;
        description?: string;
    };
    servers?: OpenApiServerEntry[];
    /** Global OpenAPI security requirements (e.g. [{ bearerAuth: [] }]). Distinct from scheme definitions. */
    security?: Record<string, string[]>[];
    /**
     * Whether to document operations marked `internal`. Defaults to `false` — internal ops
     * are omitted from the spec so external consumers don't see them. Set to `true` for an
     * internal-use spec.
     */
    includeInternal?: boolean;
}

// ─── Type reachability ────────────────────────────────────────────────────

function collectRefsFromType(type: ContractTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            out.add(type.name);
            break;
        case 'array':
            collectRefsFromType(type.item, out);
            break;
        case 'tuple':
            for (const item of type.items) collectRefsFromType(item, out);
            break;
        case 'record':
            collectRefsFromType(type.value, out);
            break;
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            for (const member of type.members) collectRefsFromType(member, out);
            break;
        case 'lazy':
            collectRefsFromType(type.inner, out);
            break;
        case 'inlineObject':
            for (const field of type.fields) collectRefsFromType(field.type, out);
            break;
    }
}

function collectParamSourceRefs(source: ParamSource | undefined, out: Set<string>): void {
    if (!source) return;
    if (source.kind === 'ref') {
        out.add(source.name);
        return;
    }
    if (source.kind === 'params') {
        for (const p of source.nodes) collectRefsFromType(p.type, out);
        return;
    }
    collectRefsFromType(source.node, out);
}

/** Collect all type names directly referenced by public operations (seed set). */
function collectPublicTypeRefs(opRoots: OpRootNode[], includeInternal = false): Set<string> {
    const refs = new Set<string>();
    for (const opRoot of opRoots) {
        for (const route of opRoot.routes) {
            for (const op of route.operations) {
                if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
                if (op.request) {
                    for (const body of op.request.bodies) collectRefsFromType(body.bodyType, refs);
                }
                for (const resp of op.responses) {
                    if (resp.bodyType) collectRefsFromType(resp.bodyType, refs);
                    if (resp.headers) {
                        for (const h of resp.headers) collectRefsFromType(h.type, refs);
                    }
                }
                collectParamSourceRefs(route.params, refs);
                collectParamSourceRefs(op.query, refs);
                collectParamSourceRefs(op.headers, refs);
            }
        }
    }
    return refs;
}

/** BFS-expand seed type names through the contract model graph. */
function computeReachableSchemas(seeds: Set<string>, modelMap: Map<string, ModelNode>): Set<string> {
    const reachable = new Set<string>(seeds);
    const frontier = [...seeds];
    while (frontier.length > 0) {
        const name = frontier.pop()!;
        const model = modelMap.get(name);
        if (!model) continue;
        const refs = new Set<string>();
        if (model.type) collectRefsFromType(model.type, refs);
        for (const field of model.fields) collectRefsFromType(field.type, refs);
        if (model.bases) for (const b of model.bases) refs.add(b);
        for (const ref of refs) {
            if (!reachable.has(ref)) {
                reachable.add(ref);
                frontier.push(ref);
            }
        }
    }
    return reachable;
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface OpenApiCodegenContext {
    contractRoots: ContractRootNode[];
    opRoots: OpRootNode[];
    config: OpenApiConfig;
    /** Named OpenAPI security scheme definitions to include in components.securitySchemes */
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
}

export function generateOpenApi(ctx: OpenApiCodegenContext): string {
    const { contractRoots, opRoots, config, securitySchemes } = ctx;
    const includeInternal = config.includeInternal ?? false;

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

    // Build component schemas from all contract models
    const allSchemas: Record<string, unknown> = {};
    const modelMap = new Map<string, ModelNode>();

    for (const contractRoot of contractRoots) {
        for (const model of contractRoot.models) {
            modelMap.set(model.name, model);
        }
    }
    for (const contractRoot of contractRoots) {
        for (const model of contractRoot.models) {
            allSchemas[model.name] = modelToSchema(model, modelMap);
        }
    }

    // Build paths from all operation files
    const paths: Record<string, Record<string, unknown>> = {};

    for (const opRoot of opRoots) {
        for (const route of opRoot.routes) {
            const oaPath = convertPath(route.path);

            for (const op of route.operations) {
                const mods = resolveModifiers(route, op);
                if (!includeInternal && mods.includes('internal')) continue;
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

    // Filter schemas to only include types reachable from public operations.
    // When there are no op files, all schemas are included (no filtering).
    const schemas: Record<string, unknown> =
        opRoots.length > 0
            ? (() => {
                  const reachable = computeReachableSchemas(collectPublicTypeRefs(opRoots, includeInternal), modelMap);
                  const filtered: Record<string, unknown> = {};
                  for (const [name, schema] of Object.entries(allSchemas)) {
                      if (reachable.has(name)) filtered[name] = schema;
                  }
                  return filtered;
              })()
            : allSchemas;

    const components: Record<string, unknown> = {};
    if (Object.keys(schemas).length > 0) {
        components.schemas = schemas;
    }
    if (securitySchemes && Object.keys(securitySchemes).length > 0) {
        components.securitySchemes = securitySchemes;
    }
    if (Object.keys(components).length > 0) {
        doc.components = components;
    }

    return toYaml(doc);
}

// ─── Path conversion ──────────────────────────────────────────────────────

/** Path is already in OpenAPI `{param}` style — return as-is. */
function convertPath(path: string): string {
    return path;
}

// ─── Schema conversion ───────────────────────────────────────────────────

function modelToSchema(model: ModelNode, modelMap?: Map<string, ModelNode>): Record<string, unknown> {
    // Type alias (no fields)
    if (model.type) {
        const schema = typeToSchema(model.type, modelMap);
        if (model.description) schema.description = model.description;
        return schema;
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of model.fields) {
        const prop = fieldToSchema(field, modelMap);
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

    if (model.bases && model.bases.length > 0) {
        return {
            allOf: [...model.bases.map(b => ({ $ref: `#/components/schemas/${b}` })), schema],
        };
    }

    if (model.description) {
        schema.description = model.description;
    }
    if (model.deprecated) {
        schema.deprecated = true;
    }

    return schema;
}

function fieldToSchema(field: FieldNode, modelMap?: Map<string, ModelNode>): Record<string, unknown> {
    let schema = typeToSchema(field.type, modelMap);

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
    if (field.deprecated) {
        schema.deprecated = true;
    }

    return schema;
}

function typeToSchema(type: ContractTypeNode, modelMap?: Map<string, ModelNode>): Record<string, unknown> {
    switch (type.kind) {
        case 'scalar':
            return scalarToSchema(type);
        case 'array':
            return arrayToSchema(type, modelMap);
        case 'tuple':
            return { type: 'array', prefixItems: type.items.map(i => typeToSchema(i, modelMap)) };
        case 'record':
            return { type: 'object', additionalProperties: typeToSchema(type.value, modelMap) };
        case 'enum':
            return { type: 'string', enum: type.values };
        case 'literal':
            return { const: type.value };
        case 'union':
            return { oneOf: type.members.map(m => typeToSchema(m, modelMap)) };
        case 'discriminatedUnion': {
            const oneOf = type.members.map(m => typeToSchema(m, modelMap));
            const mapping: Record<string, string> = {};
            for (const member of type.members) {
                if (member.kind !== 'ref') continue;
                const literalValues = resolveDiscriminatorLiterals(member.name, type.discriminator, modelMap);
                if (literalValues.length === 0) continue;
                for (const v of literalValues) {
                    mapping[v] = `#/components/schemas/${member.name}`;
                }
            }
            const result: Record<string, unknown> = {
                oneOf,
                discriminator: { propertyName: type.discriminator },
            };
            if (Object.keys(mapping).length > 0) {
                (result.discriminator as Record<string, unknown>).mapping = mapping;
            }
            return result;
        }
        case 'intersection':
            return { allOf: type.members.map(m => typeToSchema(m, modelMap)) };
        case 'ref':
            return { $ref: `#/components/schemas/${type.name}` };
        case 'inlineObject':
            return inlineObjectToSchema(type.fields, modelMap);
        case 'lazy':
            return typeToSchema(type.inner, modelMap);
    }
}

/** Resolve literal values of a model's discriminator field. Returns [] if not resolvable. */
function resolveDiscriminatorLiterals(modelName: string, discriminator: string, modelMap?: Map<string, ModelNode>): string[] {
    if (!modelMap) return [];
    const model = modelMap.get(modelName);
    if (!model) return [];
    const field = model.fields.find(f => f.name === discriminator);
    if (!field) return [];
    if (field.type.kind === 'literal') return [String(field.type.value)];
    if (field.type.kind === 'enum') return field.type.values;
    return [];
}

function scalarToSchema(type: import('@contractkit/core').ScalarTypeNode): Record<string, unknown> {
    const s: Record<string, unknown> = {};

    switch (type.name) {
        case 'string':
            s.type = 'string';
            if (type.min !== undefined) s.minLength = Number(type.min);
            if (type.max !== undefined) s.maxLength = Number(type.max);
            if (type.len !== undefined) {
                s.minLength = type.len;
                s.maxLength = type.len;
            }
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
        case 'duration':
            s.type = 'string';
            s.format = 'duration';
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
        case 'json':
            // Any JSON value — no type constraint
            break;
    }

    return s;
}

function arrayToSchema(type: import('@contractkit/core').ArrayTypeNode, modelMap?: Map<string, ModelNode>): Record<string, unknown> {
    const s: Record<string, unknown> = { type: 'array', items: typeToSchema(type.item, modelMap) };
    if (type.min !== undefined) s.minItems = type.min;
    if (type.max !== undefined) s.maxItems = type.max;
    return s;
}

function inlineObjectToSchema(fields: FieldNode[], modelMap?: Map<string, ModelNode>): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const field of fields) {
        properties[field.name] = fieldToSchema(field, modelMap);
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
    if (op.request && op.request.bodies.length > 0) {
        const content: Record<string, { schema: ReturnType<typeof typeToSchema> }> = {};
        for (const body of op.request.bodies) {
            content[body.contentType] = { schema: typeToSchema(body.bodyType) };
        }
        operation.requestBody = { required: true, content };
    }

    // Effective security (operation-level wins; falls back to route-level)
    // security: none → empty array (explicit public endpoint, overrides global default)
    // security: { fields } → omit operation-level entry (rely on global security from config)
    const effectiveSecurity = resolveSecurity(route, op);
    if (effectiveSecurity === SECURITY_NONE) {
        operation.security = [];
    }

    // Responses
    const responses: Record<string, unknown> = {};
    for (const resp of op.responses) {
        const statusKey = String(resp.statusCode);
        const responseObject: Record<string, unknown> = {
            description: statusDescription(resp.statusCode),
        };
        if (resp.bodyType && resp.contentType) {
            responseObject.content = {
                [resp.contentType]: {
                    schema: typeToSchema(resp.bodyType),
                },
            };
        }
        if (resp.headers && resp.headers.length > 0) {
            const headers: Record<string, unknown> = {};
            for (const h of resp.headers) {
                const headerObject: Record<string, unknown> = {
                    schema: typeToSchema(h.type),
                };
                if (!h.optional) headerObject.required = true;
                if (h.description) headerObject.description = h.description;
                headers[h.name] = headerObject;
            }
            responseObject.headers = headers;
        }
        responses[statusKey] = responseObject;
    }

    if (Object.keys(responses).length > 0) {
        operation.responses = responses;
    }

    return operation;
}

function paramSourceToParams(source: ParamSource, location: 'path' | 'query' | 'header'): Record<string, unknown>[] {
    if (source.kind === 'ref') {
        // Type reference name used as param source — emit a single $ref
        return [
            {
                name: source.name,
                in: location,
                required: location === 'path',
                schema: { $ref: `#/components/schemas/${source.name}` },
            },
        ];
    }

    if (source.kind === 'params') {
        // Inline param declarations
        return source.nodes.map(p => ({
            name: p.name,
            in: location,
            required: location === 'path',
            schema: typeToSchema(p.type),
        }));
    }

    // ContractTypeNode (inline object or other type) — if it's an inlineObject, expand fields
    if (source.node.kind === 'inlineObject') {
        return source.node.fields.map(f => ({
            name: f.name,
            in: location,
            required: location === 'path' ? true : !f.optional,
            schema: typeToSchema(f.type),
        }));
    }

    // For a ref type used as param source
    if (source.node.kind === 'ref') {
        return [
            {
                name: source.node.name,
                in: location,
                required: location === 'path',
                schema: { $ref: `#/components/schemas/${source.node.name}` },
            },
        ];
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
            const items = value.map(v => (typeof v === 'string' ? yamlString(v) : String(v)));
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
                    const firstValStr = isComplex(firstVal) ? `\n${toYamlValue(firstVal, indent + 2)}` : ` ${toYaml(firstVal, indent + 2)}`;
                    lines.push(`${pad}- ${yamlKey(firstKey)}:${firstValStr}`);
                    for (let i = 1; i < entries.length; i++) {
                        const [k, v] = entries[i]!;
                        const valStr = isComplex(v) ? `\n${toYamlValue(v, indent + 2)}` : ` ${toYaml(v, indent + 2)}`;
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
            const items = value.map(v => (typeof v === 'string' ? yamlString(v) : String(v)));
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
    if (/^[\w./-]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) && !/^\d/.test(s)) {
        return s;
    }
    // Single-quote, escaping internal single quotes by doubling
    return `'${s.replace(/'/g, "''")}'`;
}

function yamlKey(key: string): string {
    // Keys with special chars need quoting
    if (/^[\w-]+$/.test(key) && !/^(true|false|null|yes|no|on|off)$/i.test(key)) {
        return key;
    }
    return `'${key.replace(/'/g, "''")}'`;
}
