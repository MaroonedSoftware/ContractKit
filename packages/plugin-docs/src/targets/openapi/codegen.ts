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
import {
    decimalPattern,
    deriveSdkMethodName,
    MCP_EXCLUDE,
    resolveEffectiveFields,
    resolveMcpHints,
    resolveModifiers,
    resolveSecurity,
    SECURITY_NONE,
} from '@contractkit/core';

/** A single entry for the OpenAPI `servers` array. */
export interface OpenApiServerEntry {
    url: string;
    description?: string;
}

/** One OAuth 2.0 flow of an `oauth2` security scheme, keyed by flow name (`authorizationCode`, `clientCredentials`, ...). */
export interface OpenApiOAuthFlow {
    authorizationUrl?: string;
    tokenUrl?: string;
    refreshUrl?: string;
    /** Every scope the flow can grant, with a description of each. */
    scopes: Record<string, string>;
}

/** A named entry for `components.securitySchemes` (an HTTP bearer, API-key, OAuth 2.0 or OpenID Connect scheme). */
export interface OpenApiSecurityScheme {
    type: string;
    description?: string;
    scheme?: string;
    bearerFormat?: string;
    name?: string;
    in?: string;
    flows?: Record<string, OpenApiOAuthFlow>;
    openIdConnectUrl?: string;
}

/** An OpenAPI security requirement list: any one entry satisfies it, each mapping a scheme name to the scopes it needs. */
export type OpenApiSecurityRequirements = Record<string, string[]>[];

/** Plugin configuration controlling the generated OpenAPI document (info block, servers, security, internal-op visibility). */
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
    /**
     * Whether to leave out operations marked `mcp: exclude`. Defaults to `false`. A contract excludes
     * an operation from MCP when no agent should call it (sign-in, step-up actions), and a spec
     * published for agents to build connectors from should leave out the same operations.
     */
    omitMcpExcluded?: boolean;
    /**
     * How `operationId`s are named. `'service'` (the default) uses `sdk:`, else the service method,
     * else the SDK method name. `'sdk'` always uses the TypeScript SDK's method name, so a client
     * generated from the spec names its calls as the SDK does. Either way the ids are unique: one
     * that collides with an earlier operation's falls back to the SDK name, then gets a number.
     */
    operationIds?: 'service' | 'sdk';
    /** Tag each operation with its file's `area` meta, and list the areas under `tags`. Defaults to `false`. */
    tags?: boolean;
    /**
     * Security for every operation that is not `security: none`, chosen by whether it only reads:
     * `read` for an operation whose MCP `readOnlyHint` holds (its `mcp` hint, else its method),
     * `write` for the rest. Lets a spec name the OAuth scopes a call needs, e.g.
     * `{ read: [{ oauth: ['api.read'] }], write: [{ oauth: ['api.write'] }] }`. Without it an
     * authenticated operation relies on the global `security`.
     */
    operationSecurity?: { read: OpenApiSecurityRequirements; write: OpenApiSecurityRequirements };
    /** Add `x-mcp-annotations` (the four MCP tool hints) to every operation. Defaults to `false`. */
    mcpAnnotations?: boolean;
}

/** Whether the config leaves an operation out of the spec. */
function isOmitted(route: OpRouteNode, op: OpOperationNode, config: OpenApiConfig): boolean {
    if (!(config.includeInternal ?? false) && resolveModifiers(route, op).includes('internal')) return true;
    return (config.omitMcpExcluded ?? false) && op.mcp === MCP_EXCLUDE;
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

/** Collect all type names directly referenced by the documented operations (seed set). */
function collectPublicTypeRefs(opRoots: OpRootNode[], config: OpenApiConfig): Set<string> {
    const refs = new Set<string>();
    for (const opRoot of opRoots) {
        for (const route of opRoot.routes) {
            for (const op of route.operations) {
                if (isOmitted(route, op, config)) continue;
                if (op.request) {
                    for (const body of op.request.bodies) collectRefsFromType(body.bodyType, refs);
                }
                for (const resp of op.responses) {
                    for (const body of resp.bodies) collectRefsFromType(body.bodyType, refs);
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

/** Inputs to {@link generateOpenApi}: the parsed contracts/operations plus the OpenAPI config and shared security schemes. */
export interface OpenApiCodegenContext {
    contractRoots: ContractRootNode[];
    opRoots: OpRootNode[];
    config: OpenApiConfig;
    /** Named OpenAPI security scheme definitions to include in components.securitySchemes */
    securitySchemes?: Record<string, OpenApiSecurityScheme>;
}

/**
 * Generate an OpenAPI 3.0 document (YAML) from the parsed contracts and operations.
 *
 * Emits `paths` from the operations and `components.schemas` from the contracts, honoring
 * `config.includeInternal` for `operation(internal)` visibility.
 *
 * @returns The OpenAPI document serialized as a YAML string.
 */
export function generateOpenApi(ctx: OpenApiCodegenContext): string {
    return toYaml(buildOpenApiDocument(ctx));
}

/**
 * Build the OpenAPI 3.1 document as a plain object, before serialization.
 *
 * Exists so other plugins can consume the document structurally — reading `paths` to enumerate
 * operations, or `components.schemas` to enumerate models — without parsing the YAML back.
 * {@link generateOpenApi} is this plus {@link toYaml}.
 */
export function buildOpenApiDocument(ctx: OpenApiCodegenContext): Record<string, unknown> {
    const { contractRoots, opRoots, config, securitySchemes } = ctx;

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
    // Areas in first-seen order, for the top-level `tags` list.
    const areas: string[] = [];
    // OpenAPI requires operationIds to be unique across the document.
    const operationIds = new Set<string>();

    for (const opRoot of opRoots) {
        const area = config.tags ? opRoot.meta?.area : undefined;
        for (const route of opRoot.routes) {
            const oaPath = convertPath(route.path);

            for (const op of route.operations) {
                if (isOmitted(route, op, config)) continue;
                // Lazily initialize the path object so all-omitted routes
                // leave no empty entry in the output
                if (!paths[oaPath]) paths[oaPath] = {};
                const operation = buildOperation(route, op, opRoot, config, modelMap);
                operation.operationId = uniqueOperationId(route, op, config, operationIds);
                if (resolveModifiers(route, op).includes('deprecated')) operation.deprecated = true;
                if (area) {
                    operation.tags = [area];
                    if (!areas.includes(area)) areas.push(area);
                }
                paths[oaPath][op.method] = operation;
            }
        }
    }

    if (areas.length > 0) {
        doc.tags = areas.map(name => ({ name }));
    }
    doc.paths = paths;

    // Filter schemas to only include types reachable from public operations.
    // When there are no op files, all schemas are included (no filtering).
    const schemas: Record<string, unknown> =
        opRoots.length > 0
            ? (() => {
                  const reachable = computeReachableSchemas(collectPublicTypeRefs(opRoots, config), modelMap);
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

    return doc;
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
        // A bigint is documented as a string, so its default has to be one too for the schema to
        // accept its own default.
        const isBigInt = typeof field.default === 'bigint' || (field.type.kind === 'scalar' && field.type.name === 'bigint');
        schema.default = isBigInt ? String(field.default) : field.default;
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

/**
 * The wire form of a `bigint`: an optionally negative run of digits, with the trailing `n` the
 * TypeScript SDK and server write.
 */
export const BIGINT_PATTERN = '^-?\\d+n?$';

/**
 * Map a ContractKit scalar type node to its OpenAPI schema object (`{ type, format, ... }`),
 * carrying across constraints like min/max/length.
 *
 * @throws {Error} If the scalar name is not mapped — every member of the closed scalar set must
 *   have an explicit case, so an unmapped name signals a scalar was added to core without updating
 *   this plugin (rather than silently emitting a type-less, permissive schema).
 */
export function scalarToSchema(type: import('@contractkit/core').ScalarTypeNode): Record<string, unknown> {
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
            // A digit string, not `type: integer, format: int64`. No ContractKit client sends a JSON
            // number for one (it would lose precision past 2**53, the reason for the scalar), and the
            // server's schema rejects a number, so a client generated from `integer` could not talk
            // to it. The TypeScript SDK and a TypeScript server write the `"123n"` form, the other
            // SDKs `"123"`, and every one of them reads both, hence the optional `n`.
            // `format: bigint` rather than `int64`: the value is unbounded, and a generator that keys
            // on `int64` alone could still map it to a 64-bit number.
            s.type = 'string';
            s.format = 'bigint';
            s.pattern = BIGINT_PATTERN;
            // Bounds ride in the same extensions as `decimal`'s, since `minimum`/`maximum` are
            // ignored on a string and a float could not hold them exactly anyway.
            if (type.min !== undefined) s['x-contractkit-min'] = String(type.min);
            if (type.max !== undefined) s['x-contractkit-max'] = String(type.max);
            break;
        case 'decimal':
            // A quoted string, not `type: number` — the whole point is to keep the value away from
            // the IEEE-754 double a JSON number becomes in most generators.
            s.type = 'string';
            s.format = 'decimal';
            // The shared wire grammar every generated runtime enforces, narrowed by `scale`. The
            // scaled form allows trailing zeros past the scale, because `scale` counts places after
            // they are dropped: `"1.10"` passes `scale=1`, as the server's validator agrees.
            s.pattern = decimalPattern(type.scale);
            // `minimum`/`maximum` are numeric in JSON Schema and ignored on a string type, so the
            // exact bounds ride in vendor extensions instead — which also lets the importer recover
            // them verbatim rather than reverse-engineering the pattern.
            if (type.scale !== undefined) s['x-contractkit-scale'] = type.scale;
            if (type.min !== undefined) s['x-contractkit-min'] = String(type.min);
            if (type.max !== undefined) s['x-contractkit-max'] = String(type.max);
            break;
        case 'boolean':
            s.type = 'boolean';
            break;
        case 'date':
            s.type = 'string';
            s.format = 'date';
            break;
        case 'time':
            s.type = 'string';
            s.format = 'time';
            break;
        case 'datetime':
            s.type = 'string';
            s.format = 'date-time';
            break;
        case 'duration':
            s.type = 'string';
            s.format = 'duration';
            break;
        case 'interval':
            s.type = 'string';
            s.format = 'interval';
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
        default: {
            const _exhaustive: never = type.name;
            throw new Error(`plugin-docs (openapi): unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
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

/**
 * The operation's id, unique in the document: the configured name (see `OpenApiConfig.operationIds`),
 * else the SDK method name when that one is taken, else the name with a number.
 */
function uniqueOperationId(route: OpRouteNode, op: OpOperationNode, config: OpenApiConfig, taken: Set<string>): string {
    const sdkName = deriveSdkMethodName(op, route);
    const preferred = config.operationIds === 'sdk' ? sdkName : (op.sdk ?? op.service?.split('.').pop() ?? sdkName);
    let id = taken.has(preferred) ? sdkName : preferred;
    for (let n = 2; taken.has(id); n++) id = `${sdkName}${n}`;
    taken.add(id);
    return id;
}

function buildOperation(
    route: OpRouteNode,
    op: OpOperationNode,
    root: OpRootNode,
    config: OpenApiConfig,
    modelMap: Map<string, ModelNode>,
): Record<string, unknown> {
    // operationId is filled in by the caller, which knows the ids already taken.
    const operation: Record<string, unknown> = { operationId: undefined };

    // `name:` is the operation's human-readable label, which is what `summary` is for. Without
    // it the name is lost on the way out, and lost again on the way back through `openapi-to-ck`.
    if (op.name) {
        operation.summary = op.name;
    }

    if (op.description) {
        operation.description = op.description;
    }

    // Parameters: path params + query + headers
    const parameters: Record<string, unknown>[] = [];

    if (route.params) {
        parameters.push(...paramSourceToParams(route.params, 'path', modelMap));
    }
    if (op.query) {
        parameters.push(...paramSourceToParams(op.query, 'query', modelMap));
    }
    if (op.headers) {
        parameters.push(...paramSourceToParams(op.headers, 'header', modelMap));
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

    // Effective security (operation wins, then route, then the file's `options` floor)
    // security: none → empty array (explicit public endpoint, overrides global default)
    // security: { fields } → `operationSecurity` by read or write when configured, else omit the
    // operation-level entry (rely on global security from config)
    const effectiveSecurity = resolveSecurity(route, op, root);
    const hints = resolveMcpHints(op);
    if (effectiveSecurity === SECURITY_NONE) {
        operation.security = [];
    } else if (config.operationSecurity) {
        operation.security = hints.readOnlyHint ? config.operationSecurity.read : config.operationSecurity.write;
    }
    if (config.mcpAnnotations) {
        operation['x-mcp-annotations'] = hints;
    }

    // Responses
    const responses: Record<string, unknown> = {};
    for (const resp of op.responses) {
        const statusKey = String(resp.statusCode);
        const responseObject: Record<string, unknown> = {
            description: statusDescription(resp.statusCode),
        };
        const bodies = resp.bodies;
        if (bodies.length > 0) {
            // One `content` entry per declared mime — this is where a status serving several
            // formats becomes visible to every consumer of the spec.
            const content: Record<string, unknown> = {};
            for (const body of bodies) {
                content[body.contentType] = { schema: typeToSchema(body.bodyType) };
            }
            responseObject.content = content;
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
        // OpenAPI cannot say whether the service produces a status or merely documents it, so
        // the distinction `.ck` draws would be lost on every round trip — every `(documented)`
        // error would come back as service-produced. A vendor extension is spec-legal and
        // ignored by other tooling, so carry it rather than drop it.
        if (resp.emit === 'documented') {
            responseObject['x-contractkit-emit'] = 'documented';
        }
        responses[statusKey] = responseObject;
    }

    if (Object.keys(responses).length > 0) {
        operation.responses = responses;
    }

    return operation;
}

/**
 * One parameter per field of a model used as a whole parameter source (`query: PageQuery`), as the
 * router reads them: one query string key or header each. A single object-typed parameter is legal
 * OpenAPI (form style, exploded), but many client generators and connector importers cannot take
 * one. Undefined when the model has no fields to expand (an alias to a scalar, a union).
 */
function modelFieldParams(
    name: string,
    location: 'path' | 'query' | 'header',
    modelMap: Map<string, ModelNode>,
): Record<string, unknown>[] | undefined {
    const { fields } = resolveEffectiveFields(name, modelMap);
    if (fields.length === 0) return undefined;
    const wireNames = inputKeys(name, modelMap, undefined, new Set());
    return fields.map(f => ({
        name: wireNames.get(f.name) ?? f.name,
        in: location,
        required: location === 'path' || !f.optional,
        ...(f.description ? { description: f.description } : {}),
        schema: fieldToSchema(f, modelMap),
    }));
}

/** A model's own `format(input=)`, else the first one among its bases. It renames every key the model carries. */
function modelInputCase(name: string, modelMap: Map<string, ModelNode>, seen: Set<string>): ModelNode['inputCase'] {
    const model = modelMap.get(name);
    if (!model || seen.has(name)) return undefined;
    seen.add(name);
    if (model.inputCase) return model.inputCase;
    for (const base of model.bases ?? []) {
        const inherited = modelInputCase(base, modelMap, seen);
        if (inherited) return inherited;
    }
    return undefined;
}

/**
 * Each field's key as the router reads it, by field name. A formatted model renames all of its keys
 * (bases included) to its input casing, so `fromDate` is read from `from_date`; the members of an
 * intersection alias each keep their own, as the parsing schema does.
 */
function inputKeys(
    target: string | ContractTypeNode,
    modelMap: Map<string, ModelNode>,
    keyCase: ModelNode['inputCase'],
    seen: Set<string>,
): Map<string, string> {
    const keys = new Map<string, string>();
    const add = (from: Map<string, string>) => from.forEach((wire, field) => keys.set(field, wire));
    if (typeof target === 'string') {
        const model = modelMap.get(target);
        if (!model || seen.has(target)) return keys;
        seen.add(target);
        const own = modelInputCase(target, modelMap, new Set()) ?? keyCase;
        if (model.type) return inputKeys(model.type, modelMap, own, seen);
        for (const base of model.bases ?? []) add(inputKeys(base, modelMap, own, seen));
        for (const field of model.fields) keys.set(field.name, applyCase(field.name, own));
        return keys;
    }
    switch (target.kind) {
        case 'ref':
            return inputKeys(target.name, modelMap, keyCase, seen);
        case 'intersection':
            for (const member of target.members) add(inputKeys(member, modelMap, keyCase, seen));
            return keys;
        case 'inlineObject':
            for (const field of target.fields) keys.set(field.name, applyCase(field.name, keyCase));
            return keys;
        case 'lazy':
            return inputKeys(target.inner, modelMap, keyCase, seen);
        default:
            return keys;
    }
}

function applyCase(key: string, keyCase: ModelNode['inputCase']): string {
    if (keyCase === 'snake') return key.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`);
    if (keyCase === 'pascal') return key.charAt(0).toUpperCase() + key.slice(1);
    return key;
}

function paramSourceToParams(
    source: ParamSource,
    location: 'path' | 'query' | 'header',
    modelMap: Map<string, ModelNode>,
): Record<string, unknown>[] {
    if (source.kind === 'ref') {
        const expanded = modelFieldParams(source.name, location, modelMap);
        if (expanded) return expanded;
        // A model with no fields to expand: emit a single $ref
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
            // A path param is required by definition; anything else takes the contract at its
            // word, matching the inlineObject branch below. Marking every query and header
            // parameter optional made the published spec disagree with the router, which has
            // always rejected a request missing one.
            required: location === 'path' || !p.optional,
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
        const expanded = modelFieldParams(source.node.name, location, modelMap);
        if (expanded) return expanded;
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
    // An empty object is written inline as `{}`, like an empty array. Treated as a block, it went on
    // the line after its key with no indentation at all: `additionalProperties:` then `{}` at column 0.
    return isPlainObject(value) && Object.keys(value as Record<string, unknown>).length > 0;
}

function isPlainObject(value: unknown): boolean {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A plain scalar a YAML 1.2 parser may resolve as a number rather than a string: `200`, `-5`,
 * `-0.10`, `.5`, `.inf`. Checking only for a leading digit let a negative bigint bound out bare, so
 * `'-9007199254740993'` was read back as a float and lost its last digit.
 */
const YAML_NUMBER_LIKE = /^-?(\d|\.\d|\.(inf|nan)$)/i;

function yamlString(s: string): string {
    // Use plain style if safe, otherwise single-quoted
    if (s === '') return "''";
    if (/^[\w./-]+$/.test(s) && !/^(true|false|null|yes|no|on|off)$/i.test(s) && !YAML_NUMBER_LIKE.test(s)) {
        return s;
    }
    // A line break cannot go into a single-quoted scalar as it stands. Written raw, the next line
    // starts at column 0, which a block mapping reads as the end of the value and a parser rejects;
    // indented correctly, YAML folds the break into a space and the description loses it anyway. A
    // JSON string is a valid YAML double-quoted scalar, stays on one line, and keeps `\n` exact.
    if (hasControlCharacter(s)) {
        return JSON.stringify(s);
    }
    // Single-quote, escaping internal single quotes by doubling
    return `'${s.replace(/'/g, "''")}'`;
}

/** A line break, a tab or any other C0 control character or DEL: nothing a single-quoted scalar can carry verbatim. */
function hasControlCharacter(s: string): boolean {
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 0x20 || code === 0x7f) return true;
    }
    return false;
}

function yamlKey(key: string): string {
    // Keys with special chars need quoting. A leading digit is excluded for the same reason
    // `yamlString` excludes it: a bare `200` is an integer to a YAML 1.2 parser, and OpenAPI 3.x
    // requires the keys of a `responses` object to be strings. `\w` also matches `_`, so a key
    // like `_3DModel` correctly stays bare.
    if (/^[\w-]+$/.test(key) && !/^(true|false|null|yes|no|on|off)$/i.test(key) && !/^\d/.test(key)) {
        return key;
    }
    return `'${key.replace(/'/g, "''")}'`;
}
