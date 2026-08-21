import type {
    OpRouteNode,
    OpOperationNode,
    OpParamNode,
    OpRequestNode,
    OpResponseNode,
    OpResponseBodyNode,
    OpResponseHeaderNode,
    HttpMethod,
    ModelNode,
    SourceLocation,
    SecurityNode,
} from '@contractkit/core';
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

/** A plain `type/subtype`, which is all `mimeType` in the grammar accepts. */
const MIME_RE = /^[a-z0-9][a-z0-9.+_-]*\/[a-z0-9][a-z0-9.+_-]*$/i;

/**
 * Reduce a summary to something `nameText` can hold.
 *
 * `nameText = (~("\n" | "}" | " #" | "\t#") any)+` — the value runs to end of line and stops at
 * a closing brace or a whitespace-preceded `#`. An OpenAPI summary respects none of that, and an
 * unsanitized one would mis-parse the rest of the operation.
 */
function toNameText(summary: string): string {
    return summary
        .replace(/[}#]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

/** Methods a spec may declare that `httpMethod` in the grammar has no keyword for. */
const UNSUPPORTED_METHODS = ['head', 'options', 'trace'] as const;

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
    /** How bodied 4xx/5xx responses are imported. See `ConvertOptions.errorResponses`. */
    errorResponses: 'documented' | 'emitted';
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

    for (const method of UNSUPPORTED_METHODS) {
        // A grammar limitation, not a converter one — `.ck` has no keyword for these verbs.
        if ((pathItem as Record<string, unknown>)[method]) {
            ctx.warnings.warn(`#/paths/${encodePathSegment(path)}/${method}`, `\`${method}\` operations have no .ck equivalent; dropped`);
        }
    }

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

    // summary → `name:`, the human-readable label the key exists for. `description` stays the
    // doc comment; when only a summary is given it becomes the name and is not doubled as prose.
    if (op.summary) {
        const name = toNameText(op.summary);
        if (name) node.name = name;
        else ctx.warnings.warn(`${pathPrefix}/summary`, 'summary has no content `.ck` can carry as a name; dropped');
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
        // `dereferenceComponents` inlines `#/components/parameters/*` before this runs, so a
        // parameter with no name is one nothing could resolve. Emitting it would print
        // `undefined: string`, which parses — silent corruption is worse than a dropped param.
        if (!param?.name) {
            ctx.warnings.warn(`${pathPrefix}/parameters`, 'skipped a parameter with no name (an unresolved $ref?)');
            continue;
        }
        if (param.in === 'query') {
            queryParams.push(parameterToNode(param, schemaCtx));
        } else if (param.in === 'header') {
            headerParams.push(parameterToNode(param, schemaCtx));
        } else if (param.in === 'cookie') {
            ctx.warnings.warn(`${pathPrefix}/parameters/${param.name}`, 'cookie parameters have no `.ck` equivalent; dropped');
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
        // Strictly numeric: `parseInt('4XX')` is 4, which would silently invent a status code.
        if (!/^\d{3}$/.test(code)) {
            // `default`, `2XX`, `4XX` — the response block is keyed by a numeric status.
            ctx.warnings.warn(`${pathPrefix}/responses/${code}`, `response key '${code}' is not a numeric status code; dropped`);
            continue;
        }
        const statusCode = parseInt(code, 10);
        const respNode = responseToNode(statusCode, resp, op.operationId ?? `${method}${toPascalCase(path)}`, schemaCtx, ctx);
        node.responses.push(respNode);
    }

    // Security. A spec-level `security` applies to every operation that does not override it;
    // it used to be collected and never read, so a globally-secured spec imported as unsecured.
    const security = op.security ?? ctx.globalSecurity;
    if (security !== undefined) {
        node.security = convertSecurity(security);
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

    const bodies: OpRequestNode['bodies'] = [];

    for (const [contentType, mediaType] of Object.entries(content)) {
        // `.ck` accepts any RFC 6838 `type/subtype`, so there is no reason to narrow a spec to
        // the three content types this used to allow. What it cannot carry is a parameterised
        // (`; charset=`) or wildcard mime, since `mimeType` is two `mimeChar+` runs.
        if (!MIME_RE.test(contentType)) {
            ctx.warnings.warn(`${schemaCtx.path}/requestBody/content`, `content type '${contentType}' is not a plain type/subtype; skipped`);
            continue;
        }
        if (!mediaType?.schema) continue;
        const { typeNode, model } = extractInlineModel(mediaType.schema, `${toPascalCase(operationName)}Request`, schemaCtx);
        if (model) {
            ctx.extractedModels.push(model);
        }
        bodies.push({ contentType, bodyType: typeNode });
    }

    if (bodies.length === 0) return undefined;
    return { bodies };
}

// ─── Responses ────────────────────────────────────────────────────────────

/**
 * Whether an imported status should be marked `(documented)` rather than service-produced.
 *
 * Only applies to a status that carries a block, because that is the only case where the
 * modifier does anything: `isEmitted` in core treats a block as "the service produces this", and
 * `isRedundantDocumented` warns when `(documented)` is put on a bare bodyless non-2xx, where the
 * status is already not emitted. 3xx is left alone — `observableResponses` already covers
 * everything below 400, so the marker would change nothing a client sees, and a spec'd redirect
 * body is plausibly service-produced.
 */
function shouldDocument(statusCode: number, braced: boolean, resp: NormalizedResponse, ctx: PathsContext): boolean {
    if (!braced) return false;
    // A spec this project emitted says so outright; prefer it over guessing from the status.
    if (resp['x-contractkit-emit'] === 'documented') return true;
    return statusCode >= 400 && ctx.errorResponses === 'documented';
}

function responseToNode(
    statusCode: number,
    resp: NormalizedResponse,
    operationName: string,
    schemaCtx: SchemaContext,
    ctx: PathsContext,
): OpResponseNode {
    const headers = convertResponseHeaders(resp.headers, schemaCtx);
    const documented = (braced: boolean) => (shouldDocument(statusCode, braced, resp, ctx) ? { emit: 'documented' as const } : {});
    const empty = (): OpResponseNode => ({
        statusCode,
        bodies: [],
        ...(headers ? { headers, hasBlock: true, ...documented(true) } : {}),
    });

    if (!resp.content) return empty();

    // Every declared content type is kept — `.ck` can express several mimes for one status, so
    // there is no reason to narrow a spec down to its first one on the way in.
    const bodies: OpResponseBodyNode[] = [];
    for (const [contentType, mediaType] of Object.entries(resp.content)) {
        if (!mediaType?.schema) continue;
        // The extracted model is named for the status; a second mime for the same status reuses
        // that name rather than minting a near-duplicate.
        const suffix = bodies.length === 0 ? '' : toPascalCase(contentType.replace(/[^a-z0-9]+/gi, ' '));
        const { typeNode, model } = extractInlineModel(mediaType.schema, `${toPascalCase(operationName)}Response${statusCode}${suffix}`, schemaCtx);
        if (model) ctx.extractedModels.push(model);
        bodies.push({ contentType, bodyType: typeNode });
    }

    if (bodies.length === 0) return empty();

    return {
        statusCode,
        bodies,
        hasBlock: true,
        ...(headers ? { headers } : {}),
        ...documented(true),
    };
}

function convertResponseHeaders(headers: NormalizedResponse['headers'], schemaCtx: SchemaContext): OpResponseHeaderNode[] | undefined {
    if (!headers) return undefined;
    const out: OpResponseHeaderNode[] = [];
    for (const [name, header] of Object.entries(headers)) {
        if (!header) continue;
        const type = header.schema ? schemaToTypeNode(header.schema, schemaCtx) : { kind: 'scalar' as const, name: 'string' as const };
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

    // The DSL's security model is simpler — OpenAPI scopes/roles don't map onto named policies,
    // so any non-empty security requirement is collapsed to "authenticated, default policy".
    return { loc: LOC };
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
