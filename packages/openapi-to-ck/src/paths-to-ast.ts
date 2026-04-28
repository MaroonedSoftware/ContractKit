import type {
    OpRouteNode,
    OpOperationNode,
    OpParamNode,
    OpRequestNode,
    OpResponseNode,
    OpResponseHeaderNode,
    HttpMethod,
    ModelNode,
    SourceLocation,
    SecurityNode,
} from '@maroonedsoftware/contractkit';
import type {
    NormalizedDocument,
    NormalizedPathItem,
    NormalizedOperation,
    NormalizedParameter,
    NormalizedRequestBody,
    NormalizedResponse,
} from './types.js';
import { schemaToTypeNode, extractInlineModel } from './schema-to-ast.js';
import type { SchemaContext } from './schema-to-ast.js';
import type { WarningCollector } from './warnings.js';

const LOC: SourceLocation = { file: '', line: 0 };
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

// ─── Public API ───────────────────────────────────────────────────────────

export interface PathsContext {
    circularRefs: Set<string>;
    warnings: WarningCollector;
    includeComments: boolean;
    namedSchemas: Record<string, unknown>;
    /** Accumulates inline models extracted from request/response bodies. */
    extractedModels: ModelNode[];
    /** Global security from the spec (for detecting explicit overrides). */
    globalSecurity?: Record<string, string[]>[];
}

/**
 * Convert OpenAPI paths to OpRouteNode[].
 * Returns routes along with a tag mapping for each route.
 */
export function pathsToRoutes(doc: NormalizedDocument, ctx: PathsContext): { routes: OpRouteNode[]; routeTags: Map<OpRouteNode, string> } {
    const routes: OpRouteNode[] = [];
    const routeTags = new Map<OpRouteNode, string>();
    const paths = doc.paths ?? {};

    for (const [path, pathItem] of Object.entries(paths)) {
        if (!pathItem) continue;
        const result = pathItemToRoute(path, pathItem, ctx);
        if (result) {
            routes.push(result.route);
            routeTags.set(result.route, result.tag);
        }
    }

    return { routes, routeTags };
}

// ─── Path Item → Route ───────────────────────────────────────────────────

function pathItemToRoute(path: string, pathItem: NormalizedPathItem, ctx: PathsContext): { route: OpRouteNode; tag: string } | null {
    const operations: OpOperationNode[] = [];
    let primaryTag = 'default';

    // Collect path-level parameters
    const pathParams = (pathItem.parameters ?? []).filter(p => p.in === 'path');

    for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (!op) continue;

        const opNode = operationToNode(method, op, path, ctx);
        operations.push(opNode);

        // Use first tag of first operation as the route's tag
        if (op.tags && op.tags.length > 0 && primaryTag === 'default') {
            primaryTag = op.tags[0]!;
        }
    }

    if (operations.length === 0) return null;

    // Build params from path-level + inferred from path template
    const params = buildPathParams(path, pathParams, pathItem, ctx);

    const route: OpRouteNode = {
        path,
        operations,
        loc: LOC,
    };

    if (params.length > 0) {
        route.params = { kind: 'params', nodes: params };
    }

    if (pathItem.description && ctx.includeComments) {
        route.description = pathItem.description;
    }

    return { route, tag: primaryTag };
}

// ─── Operation → Node ─────────────────────────────────────────────────────

function operationToNode(method: HttpMethod, op: NormalizedOperation, path: string, ctx: PathsContext): OpOperationNode {
    const pathPrefix = `#/paths/${encodePathSegment(path)}/${method}`;
    const schemaCtx = makeSchemaCtx(ctx, pathPrefix);

    const node: OpOperationNode = {
        method,
        responses: [],
        loc: LOC,
    };

    // operationId → sdk
    if (op.operationId) {
        node.sdk = op.operationId;
    }

    // Description
    if (op.description && ctx.includeComments) {
        node.description = op.description;
    }

    // Deprecated
    if (op.deprecated) {
        node.modifiers = ['deprecated'];
    }

    // Query and header parameters
    const queryParams: OpParamNode[] = [];
    const headerParams: OpParamNode[] = [];

    for (const param of op.parameters ?? []) {
        if (param.in === 'query') {
            queryParams.push(parameterToNode(param, schemaCtx));
        } else if (param.in === 'header') {
            headerParams.push(parameterToNode(param, schemaCtx));
        }
    }

    if (queryParams.length > 0) {
        node.query = { kind: 'params', nodes: queryParams };
    }
    if (headerParams.length > 0) {
        node.headers = { kind: 'params', nodes: headerParams };
    }

    // Request body
    if (op.requestBody) {
        node.request = requestBodyToNode(op.requestBody, op.operationId ?? `${method}${toPascalCase(path)}`, schemaCtx, ctx);
    }

    // Responses
    const responses = op.responses ?? {};
    for (const [code, resp] of Object.entries(responses)) {
        const statusCode = parseInt(code, 10);
        if (isNaN(statusCode)) continue;
        const respNode = responseToNode(statusCode, resp, op.operationId ?? `${method}${toPascalCase(path)}`, schemaCtx, ctx);
        node.responses.push(respNode);
    }

    // Security
    if (op.security !== undefined) {
        node.security = convertSecurity(op.security);
    }

    return node;
}

// ─── Parameters ───────────────────────────────────────────────────────────

function buildPathParams(path: string, pathLevelParams: NormalizedParameter[], pathItem: NormalizedPathItem, ctx: PathsContext): OpParamNode[] {
    const schemaCtx = makeSchemaCtx(ctx, `#/paths/${encodePathSegment(path)}`);

    // Collect all path params from path-level and operation-level
    const paramMap = new Map<string, NormalizedParameter>();

    for (const p of pathLevelParams) {
        paramMap.set(p.name, p);
    }

    // Also check operation-level path params
    for (const method of HTTP_METHODS) {
        const op = pathItem[method];
        if (!op?.parameters) continue;
        for (const p of op.parameters) {
            if (p.in === 'path' && !paramMap.has(p.name)) {
                paramMap.set(p.name, p);
            }
        }
    }

    // Extract param names from path template
    const templateNames = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]!);

    return templateNames.map(name => {
        const param = paramMap.get(name);
        if (param) {
            return parameterToNode(param, schemaCtx);
        }
        // Infer as uuid if no schema is given
        return {
            name,
            optional: false,
            nullable: false,
            type: { kind: 'scalar' as const, name: 'string' as const },
            loc: LOC,
        };
    });
}

function parameterToNode(param: NormalizedParameter, ctx: SchemaContext): OpParamNode {
    const type = param.schema ? schemaToTypeNode(param.schema, ctx) : { kind: 'scalar' as const, name: 'string' as const };

    return {
        name: param.name,
        optional: param.in !== 'path' && !param.required,
        nullable: false,
        type,
        description: ctx.includeComments ? param.description : undefined,
        loc: LOC,
    };
}

// ─── Request Body ─────────────────────────────────────────────────────────

function requestBodyToNode(
    reqBody: NormalizedRequestBody,
    operationName: string,
    schemaCtx: SchemaContext,
    ctx: PathsContext,
): OpRequestNode | undefined {
    const content = reqBody.content;
    if (!content) return undefined;

    const supported = new Set<string>(['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data']);
    const bodies: OpRequestNode['bodies'] = [];

    for (const [contentType, mediaType] of Object.entries(content)) {
        if (!supported.has(contentType) || !mediaType?.schema) continue;
        const { typeNode, model } = extractInlineModel(mediaType.schema, `${toPascalCase(operationName)}Request`, schemaCtx);
        if (model) {
            ctx.extractedModels.push(model);
        }
        bodies.push({
            contentType: contentType as OpRequestNode['bodies'][number]['contentType'],
            bodyType: typeNode,
        });
    }

    if (bodies.length === 0) return undefined;
    return { bodies };
}

// ─── Responses ────────────────────────────────────────────────────────────

function responseToNode(
    statusCode: number,
    resp: NormalizedResponse,
    operationName: string,
    schemaCtx: SchemaContext,
    ctx: PathsContext,
): OpResponseNode {
    const headers = convertResponseHeaders(resp.headers, schemaCtx);

    if (!resp.content) {
        return headers ? { statusCode, headers } : { statusCode };
    }

    // Pick the first content type
    const [contentType, mediaType] = Object.entries(resp.content)[0] ?? [];
    if (!contentType || !mediaType?.schema) {
        return headers ? { statusCode, headers } : { statusCode };
    }

    const { typeNode, model } = extractInlineModel(mediaType.schema, `${toPascalCase(operationName)}Response${statusCode}`, schemaCtx);

    if (model) {
        ctx.extractedModels.push(model);
    }

    return {
        statusCode,
        contentType: contentType as 'application/json',
        bodyType: typeNode,
        ...(headers ? { headers } : {}),
    };
}

function convertResponseHeaders(
    headers: NormalizedResponse['headers'],
    schemaCtx: SchemaContext,
): OpResponseHeaderNode[] | undefined {
    if (!headers) return undefined;
    const out: OpResponseHeaderNode[] = [];
    for (const [name, header] of Object.entries(headers)) {
        if (!header) continue;
        const type = header.schema
            ? schemaToTypeNode(header.schema, schemaCtx)
            : { kind: 'scalar' as const, name: 'string' as const };
        out.push({
            name,
            optional: !header.required,
            type,
            description: schemaCtx.includeComments ? header.description : undefined,
        });
    }
    return out.length > 0 ? out : undefined;
}

// ─── Security ─────────────────────────────────────────────────────────────

function convertSecurity(security: Record<string, string[]>[]): SecurityNode {
    // Empty array = explicitly no security
    if (security.length === 0) {
        return 'none';
    }

    // The DSL's security model is simpler — extract roles if present
    // For most security schemes, just note that security is required
    const allScopes: string[] = [];
    for (const requirement of security) {
        for (const scopes of Object.values(requirement)) {
            allScopes.push(...scopes);
        }
    }

    if (allScopes.length > 0) {
        return { roles: allScopes, loc: LOC };
    }

    // Security required but no specific scopes/roles
    return { roles: [], loc: LOC };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function makeSchemaCtx(ctx: PathsContext, path: string): SchemaContext {
    return {
        circularRefs: ctx.circularRefs,
        warnings: ctx.warnings,
        path,
        includeComments: ctx.includeComments,
        namedSchemas: ctx.namedSchemas as Record<string, never>,
        extractedModels: ctx.extractedModels,
        inlineCounter: 0,
    };
}

function toPascalCase(input: string): string {
    return input
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function encodePathSegment(s: string): string {
    return s.replace(/~/g, '~0').replace(/\//g, '~1');
}
