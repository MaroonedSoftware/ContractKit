import type { OpRootNode, OpRouteNode, OpOperationNode, OpRequestBodyNode, ContractTypeNode, ParamSource } from '@maroonedsoftware/contractkit';
import { resolveModifiers, isJsonMime, classifyContentType } from '@maroonedsoftware/contractkit';
import { renderInputTsType, renderOutputTsType, quoteKey, headerNameToProperty, JSON_VALUE_TYPE_DECL } from './ts-render.js';
import { pascalToDotCase, typeNeedsScalar } from './codegen-contract.js';
import { bodyTypesStructurallyEqual } from './codegen-operation.js';
import { basename, dirname, relative } from 'path';

// ─── Body strategy ────────────────────────────────────────────────────────

type BodyStrategy =
    | { kind: 'none' }
    | { kind: 'single'; body: OpRequestBodyNode }
    | { kind: 'multi-equal'; bodies: OpRequestBodyNode[] }
    | { kind: 'multi-formdata-detect'; bodies: OpRequestBodyNode[] }
    | { kind: 'multi-required-arg'; bodies: OpRequestBodyNode[] };

/** Serialize expression for a single MIME, given the source body var (e.g. 'body'). */
function jsonOrFormSerialize(varName: string, contentType: string): string {
    if (contentType === 'application/x-www-form-urlencoded') {
        return `new URLSearchParams(${varName} as unknown as Record<string, string>).toString()`;
    }
    if (contentType === 'multipart/form-data') {
        return `(${varName} as FormData)`;
    }
    // application/json + any `+json` structured suffix — JSON.stringify with bigint support.
    return `JSON.stringify(${varName}, bigIntReplacer)`;
}

/**
 * Build a runtime expression that picks the right serialization based on a contentType variable.
 * Used by the SDK when the caller passes (or defaults to) a content-type at call time.
 */
function renderSerializeExpr(varName: string, bodies: OpRequestBodyNode[], ctVar: string): string {
    // Build a chained ternary, last MIME is the fallback
    const arms = bodies.slice(0, -1);
    const last = bodies[bodies.length - 1]!;
    let expr = jsonOrFormSerialize(varName, last.contentType);
    for (let i = arms.length - 1; i >= 0; i--) {
        const arm = arms[i]!;
        expr = `${ctVar} === '${arm.contentType}' ? ${jsonOrFormSerialize(varName, arm.contentType)} : ${expr}`;
    }
    return expr;
}

function classifyBodyStrategy(op: OpOperationNode): BodyStrategy {
    const bodies = op.request?.bodies ?? [];
    if (bodies.length === 0) return { kind: 'none' };
    if (bodies.length === 1) return { kind: 'single', body: bodies[0]! };
    if (bodies.every(b => bodyTypesStructurallyEqual(b.bodyType, bodies[0]!.bodyType))) {
        return { kind: 'multi-equal', bodies };
    }
    if (bodies.some(b => b.contentType === 'multipart/form-data')) {
        return { kind: 'multi-formdata-detect', bodies };
    }
    return { kind: 'multi-required-arg', bodies };
}

// ─── Public entry point ────────────────────────────────────────────────────

export interface SdkCodegenOptions {
    typeImportPathTemplate?: string;
    outPath?: string;
    /** Map from model name → absolute output file path (for cross-module type imports) */
    modelOutPaths?: Map<string, string>;
    /** Absolute path to the shared sdk-options.ts file (if set, imports SdkOptions instead of defining inline) */
    sdkOptionsPath?: string;
    /** Set of model names that have Input variants (models with visibility modifiers) */
    modelsWithInput?: Set<string>;
    /** Set of model names that have Output variants (models with format(output=...)) */
    modelsWithOutput?: Set<string>;
    /**
     * Whether to emit SDK methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted from the SDK so consumers don't pick them up. Set to `true`
     * to include them (e.g. for an internal-use SDK).
     */
    includeInternal?: boolean;
}

/**
 * Returns true if the root contains at least one operation eligible for SDK emission.
 * With `includeInternal: false` (default) that means at least one non-internal op; with
 * `includeInternal: true` any op qualifies.
 */
export function hasPublicOperations(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (includeInternal || !resolveModifiers(route, op).includes('internal')) return true;
        }
    }
    return false;
}

export function generateSdk(root: OpRootNode, options: SdkCodegenOptions = {}): string {
    const lines: string[] = [];
    const includeInternal = options.includeInternal ?? false;

    const types = collectTypes(root, options.modelsWithInput, options.modelsWithOutput, includeInternal);
    const clientClassName = deriveClientClassName(root.file);

    // Type-only imports
    if (types.length > 0) {
        lines.push(...generateTypeImports(types, root.file, options));
    }

    // SdkOptions import (from shared file) or inline fallback
    if (options.sdkOptionsPath && options.outPath) {
        let rel = relative(dirname(options.outPath), options.sdkOptionsPath);
        rel = rel.replace(/\.ts$/, '.js');
        if (!rel.startsWith('.')) rel = './' + rel;
        const jsonImport = sdkNeedsJson(root, includeInternal) ? ', JsonValue' : '';
        lines.push(`import type { SdkFetch${jsonImport} } from '${rel}';`);
        const valueImports: string[] = [];
        if (sdkNeedsBigIntReplacer(root, includeInternal)) valueImports.push('bigIntReplacer');
        if (sdkNeedsBigIntReviver(root, includeInternal)) valueImports.push('parseJson');
        if (sdkNeedsQueryString(root, includeInternal)) valueImports.push('buildQueryString');
        if (valueImports.length > 0) {
            lines.push(`import { ${valueImports.join(', ')} } from '${rel}';`);
        }
    } else {
        lines.push('');
        lines.push('export class SdkError extends Error {');
        lines.push('    constructor(');
        lines.push('        public readonly status: number,');
        lines.push('        public readonly statusText: string,');
        lines.push('        public readonly body: unknown,');
        lines.push('    ) {');
        lines.push('        super(`${status} ${statusText}`);');
        lines.push("        this.name = 'SdkError';");
        lines.push('    }');
        lines.push('}');
        lines.push('');
        lines.push('export type SdkFetch = (url: string, init: RequestInit) => Promise<Response>;');
        lines.push('');
        lines.push('export interface SdkOptions {');
        lines.push('    baseUrl: string;');
        lines.push('    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);');
        lines.push('    fetch?: SdkFetch;');
        lines.push('    /** Called once per request to produce a unique X-Request-ID header value */');
        lines.push('    requestIdFactory?: () => string;');
        lines.push('}');
        lines.push('');
        lines.push('export function createSdkFetch(options: SdkOptions): SdkFetch {');
        lines.push('    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());');
        lines.push('    return async (url: string, init: RequestInit): Promise<Response> => {');
        lines.push("        const baseHeaders = typeof options.headers === 'function'");
        lines.push('            ? await options.headers()');
        lines.push('            : options.headers ?? {};');
        lines.push('        const res = await fetch(`${options.baseUrl}${url}`, {');
        lines.push('            ...init,');
        lines.push("            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...init.headers as Record<string, string> },");
        lines.push('        });');
        lines.push('        if (!res.ok) {');
        lines.push('            const text = await res.text();');
        lines.push('            let body: unknown;');
        lines.push('            try { body = JSON.parse(text); } catch { body = text; }');
        lines.push('            throw new SdkError(res.status, res.statusText, body);');
        lines.push('        }');
        lines.push('        return res;');
        lines.push('    };');
        lines.push('}');
        lines.push('');
        lines.push('export function buildQueryString(query: object | undefined): string {');
        lines.push('    const searchParams = new URLSearchParams();');
        lines.push('    if (query) {');
        lines.push('        for (const [k, v] of Object.entries(query)) {');
        lines.push('            if (v === undefined || v === null) continue;');
        lines.push('            if (Array.isArray(v)) { for (const item of v) searchParams.append(k, String(item)); }');
        lines.push('            else searchParams.set(k, String(v));');
        lines.push('        }');
        lines.push('    }');
        lines.push('    const qs = searchParams.toString();');
        lines.push("    return qs ? `?${qs}` : '';");
        lines.push('}');
        lines.push('');
        lines.push('export async function parseJson<T>(res: Response): Promise<T> {');
        lines.push('    return JSON.parse(await res.text(), bigIntReviver) as T;');
        lines.push('}');
    }

    if (sdkNeedsJson(root, includeInternal) && !(options.sdkOptionsPath && options.outPath)) {
        lines.push(JSON_VALUE_TYPE_DECL);
    }

    lines.push('');

    // Client class
    lines.push('/**');
    const relFile = options.outPath ? relative(dirname(options.outPath), root.file) : root.file;
    lines.push(` * generated from [${basename(root.file)}](file://./${relFile})`);
    lines.push(' */');
    lines.push(`export class ${clientClassName} {`);
    lines.push('    constructor(private fetch: SdkFetch) {}');

    for (const route of root.routes) {
        for (const op of route.operations) {
            const mods = resolveModifiers(route, op);
            if (!includeInternal && mods.includes('internal')) continue;
            lines.push('');
            if (mods.includes('deprecated')) lines.push('    /** @deprecated */');
            lines.push(...generateMethod(route, op, root.file, options));
        }
    }

    lines.push('}');
    lines.push('');

    return lines.join('\n');
}

// ─── Method generation ────────────────────────────────────────────────────

function generateMethod(route: OpRouteNode, op: OpOperationNode, file: string, options: SdkCodegenOptions): string[] {
    const lines: string[] = [];
    const methodName = deriveMethodName(op, route);
    const httpMethod = op.method.toUpperCase();
    const { modelsWithInput, modelsWithOutput } = options;

    // Build method parameters (request-side — use Input variants)
    const params = buildMethodParams(route, op, modelsWithInput);
    const paramStr = params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');

    // Determine return type — response side uses Output variants (post-transform wire shape).
    // For non-JSON responses the schema is ignored: text/* is read as string, binary as Blob.
    const primaryResponse = op.responses.find(r => r.bodyType) ?? op.responses[0];
    const isVoid = !primaryResponse?.bodyType;
    const respCategory = primaryResponse?.contentType ? classifyContentType(primaryResponse.contentType) : 'json';
    const dataType = isVoid
        ? 'void'
        : respCategory === 'text'
            ? 'string'
            : respCategory === 'binary'
                ? 'Blob'
                : renderOutputTsType(primaryResponse!.bodyType!, modelsWithOutput);
    const respHeaders = primaryResponse?.headers ?? [];
    const hasRespHeaders = respHeaders.length > 0;
    const headersShape = hasRespHeaders
        ? `{ ${respHeaders.map(h => `${quoteKey(headerNameToProperty(h.name))}${h.optional ? '?' : ''}: ${renderOutputTsType(h.type, modelsWithOutput)}`).join('; ')} }`
        : '';
    const returnType = hasRespHeaders
        ? isVoid
            ? `{ headers: ${headersShape} }`
            : `{ data: ${dataType}; headers: ${headersShape} }`
        : dataType;

    // JSDoc
    const desc = op.description ?? route.description;
    if (op.name || desc) {
        const tags: string[] = [];
        if (op.name) tags.push(`@name ${op.name}`);
        if (desc) tags.push(`@description ${desc}`);
        if (tags.length === 1) {
            lines.push(`    /** ${tags[0]} */`);
        } else {
            lines.push(`    /**`);
            for (const tag of tags) lines.push(`     * ${tag}`);
            lines.push(`     */`);
        }
    }

    lines.push(`    async ${methodName}(${paramStr}): Promise<${returnType}> {`);

    // Build URL with path params
    const urlExpr = buildUrlExpression(route.path, route.params);

    // Query string
    const hasQuery = !!op.query;
    let fetchUrl = urlExpr;
    if (hasQuery) {
        lines.push(`        const qs = buildQueryString(query);`);
        fetchUrl = urlExpr;
    }

    // Build fetch options
    const strategy = classifyBodyStrategy(op);
    const hasBody = strategy.kind !== 'none';
    const hasOpHeaders = !!op.headers;

    // Pre-emit serialization preludes for multi-MIME strategies
    if (strategy.kind === 'multi-equal') {
        const defaultCt = strategy.bodies[0]!.contentType;
        lines.push(`        const __contentType = options?.contentType ?? '${defaultCt}';`);
        lines.push(`        const __serialized = ${renderSerializeExpr('body', strategy.bodies, '__contentType')};`);
    } else if (strategy.kind === 'multi-formdata-detect') {
        lines.push(`        const __isFormData = body instanceof FormData;`);
        const nonMultipart = strategy.bodies.find(b => b.contentType !== 'multipart/form-data')!;
        lines.push(`        const __contentType: string = __isFormData ? 'multipart/form-data' : '${nonMultipart.contentType}';`);
        lines.push(
            `        const __serialized: BodyInit = __isFormData ? (body as FormData) : ${jsonOrFormSerialize('body', nonMultipart.contentType)};`,
        );
    } else if (strategy.kind === 'multi-required-arg') {
        lines.push(`        const __contentType = options.contentType;`);
        lines.push(`        const __serialized = ${renderSerializeExpr('body', strategy.bodies, '__contentType')};`);
    }

    const fetchArgs: string[] = [];

    if (hasQuery) {
        fetchArgs.push(`url: \`${fetchUrl}\${qs}\``);
    } else {
        fetchArgs.push(`url: \`${fetchUrl}\``);
    }

    fetchArgs.push(`method: '${httpMethod}'`);

    if (strategy.kind === 'single') {
        const body = strategy.body;
        const cat = classifyContentType(body.contentType);
        if (cat === 'multipart') {
            // FormData supplies its own Content-Type with boundary; don't override it.
            fetchArgs.push('body: body');
        } else if (cat === 'urlencoded') {
            fetchArgs.push(`headers: { 'Content-Type': '${body.contentType}' }`);
            fetchArgs.push('body: new URLSearchParams(body as unknown as Record<string, string>).toString()');
        } else if (cat === 'text' || cat === 'binary') {
            // text/* and binary mimes pass the body through to fetch as-is — no schema serialization.
            fetchArgs.push(`headers: { 'Content-Type': '${body.contentType}' }`);
            fetchArgs.push('body: body');
        } else {
            fetchArgs.push(`headers: { 'Content-Type': '${body.contentType}' }`);
            fetchArgs.push('body: JSON.stringify(body, bigIntReplacer)');
        }
    } else if (hasBody) {
        // multi-equal | multi-formdata-detect | multi-required-arg — share a __contentType / __serialized prelude
        fetchArgs.push(`headers: { 'Content-Type': __contentType }`);
        fetchArgs.push('body: __serialized');
    }

    if (hasOpHeaders) {
        const lastHeaderIdx = fetchArgs.findIndex(a => a.startsWith('headers:'));
        if (lastHeaderIdx !== -1) {
            const existing = fetchArgs[lastHeaderIdx]!;
            const inner = existing.slice('headers: '.length).replace(/^\{\s*|\s*\}$/g, '');
            fetchArgs[lastHeaderIdx] = `headers: { ${inner}, ...customHeaders }`;
        } else {
            fetchArgs.push('headers: customHeaders');
        }
    }

    const resultPrefix = isVoid && !hasRespHeaders ? '' : 'const result = ';
    if (fetchArgs.length === 2 && !hasBody && !hasOpHeaders && !hasQuery) {
        // Simple case — inline
        lines.push(`        ${resultPrefix}await this.fetch(\`${fetchUrl}\`, { method: '${httpMethod}' });`);
    } else {
        lines.push(`        ${resultPrefix}await this.fetch(${fetchArgs[0]!.split(': ').slice(1).join(': ')}, {`);
        for (let i = 1; i < fetchArgs.length; i++) {
            lines.push(`            ${fetchArgs[i]},`);
        }
        lines.push(`        });`);
    }

    const readBodyExpr =
        respCategory === 'text'
            ? `await result.text()`
            : respCategory === 'binary'
                ? `await result.blob()`
                : `await parseJson<${dataType}>(result)`;

    if (hasRespHeaders) {
        const headerEntries = respHeaders
            .map(h => `${quoteKey(headerNameToProperty(h.name))}: result.headers.get('${h.name}') ?? undefined`)
            .join(', ');
        if (isVoid) {
            lines.push(`        return { headers: { ${headerEntries} } };`);
        } else {
            lines.push(`        const data = ${readBodyExpr};`);
            lines.push(`        return { data, headers: { ${headerEntries} } };`);
        }
    } else if (!isVoid) {
        lines.push(`        return ${readBodyExpr};`);
    }

    lines.push('    }');

    return lines;
}

// ─── URL building ─────────────────────────────────────────────────────────

function buildUrlExpression(path: string, _?: ParamSource): string {
    // Replace {paramName} with ${encodeURIComponent(paramName)}
    return path.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (_match, name) => {
        return `\${encodeURIComponent(${name})}`;
    });
}

// ─── Method parameters ────────────────────────────────────────────────────

interface MethodParam {
    name: string;
    type: string;
    optional: boolean;
}

function buildMethodParams(route: OpRouteNode, op: OpOperationNode, modelsWithInput?: Set<string>): MethodParam[] {
    const params: MethodParam[] = [];

    // Path params — always first, always required (request-side — use Input variants)
    if (route.params) {
        if (route.params.kind === 'params') {
            for (const p of route.params.nodes) {
                params.push({ name: p.name, type: renderInputTsType(p.type, modelsWithInput), optional: false });
            }
        } else if (route.params.kind === 'ref') {
            const typeName = modelsWithInput?.has(route.params.name) ? `${route.params.name}Input` : route.params.name;
            params.push({ name: 'params', type: typeName, optional: false });
        } else {
            params.push({ name: 'params', type: renderInputTsType(route.params.node, modelsWithInput), optional: false });
        }
    }

    // Body (request-side — use Input variants)
    const strategy = classifyBodyStrategy(op);
    if (strategy.kind === 'single') {
        const body = strategy.body;
        const cat = classifyContentType(body.contentType);
        if (cat === 'multipart') {
            params.push({ name: 'body', type: 'FormData', optional: false });
        } else if (cat === 'text') {
            params.push({ name: 'body', type: 'string', optional: false });
        } else if (cat === 'binary') {
            params.push({ name: 'body', type: 'Blob | ArrayBuffer | Uint8Array | string', optional: false });
        } else {
            params.push({ name: 'body', type: renderInputTsType(body.bodyType, modelsWithInput), optional: false });
        }
    } else if (strategy.kind === 'multi-equal') {
        const bodies = strategy.bodies;
        const bodyType = renderInputTsType(bodies[0]!.bodyType, modelsWithInput);
        params.push({ name: 'body', type: bodyType, optional: false });
        const ctUnion = bodies.map(b => `'${b.contentType}'`).join(' | ');
        params.push({ name: 'options', type: `{ contentType?: ${ctUnion} }`, optional: true });
    } else if (strategy.kind === 'multi-formdata-detect') {
        const types = strategy.bodies
            .map(b => (b.contentType === 'multipart/form-data' ? 'FormData' : renderInputTsType(b.bodyType, modelsWithInput)))
            .join(' | ');
        params.push({ name: 'body', type: types, optional: false });
    } else if (strategy.kind === 'multi-required-arg') {
        const types = strategy.bodies
            .map(b => (b.contentType === 'multipart/form-data' ? 'FormData' : renderInputTsType(b.bodyType, modelsWithInput)))
            .join(' | ');
        params.push({ name: 'body', type: types, optional: false });
        const ctUnion = strategy.bodies.map(b => `'${b.contentType}'`).join(' | ');
        params.push({ name: 'options', type: `{ contentType: ${ctUnion} }`, optional: false });
    }

    // Query (request-side — use Input variants)
    if (op.query) {
        if (op.query.kind === 'params') {
            const fields = op.query.nodes.map(p => `${quoteKey(p.name)}?: ${renderInputTsType(p.type, modelsWithInput)}`).join('; ');
            params.push({ name: 'query', type: `{ ${fields} }`, optional: true });
        } else if (op.query.kind === 'ref') {
            const typeName = modelsWithInput?.has(op.query.name) ? `${op.query.name}Input` : op.query.name;
            params.push({ name: 'query', type: typeName, optional: true });
        } else {
            params.push({ name: 'query', type: renderInputTsType(op.query.node, modelsWithInput), optional: true });
        }
    }

    // Headers (request-side — use Input variants)
    if (op.headers) {
        if (op.headers.kind === 'params') {
            const fields = op.headers.nodes.map(p => `${quoteKey(p.name)}?: ${renderInputTsType(p.type, modelsWithInput)}`).join('; ');
            params.push({ name: 'customHeaders', type: `{ ${fields} }`, optional: true });
        } else if (op.headers.kind === 'ref') {
            const typeName = modelsWithInput?.has(op.headers.name) ? `${op.headers.name}Input` : op.headers.name;
            params.push({ name: 'customHeaders', type: typeName, optional: true });
        } else {
            params.push({ name: 'customHeaders', type: renderInputTsType(op.headers.node, modelsWithInput), optional: true });
        }
    }

    return params;
}

// ─── Method name inference ────────────────────────────────────────────────

function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return op.sdk;
    if (op.name) return nameToMethodName(op.name);
    return inferMethodName(op.method, route.path);
}

function nameToMethodName(name: string): string {
    const parts = name.split(/[\s\-_]+/).filter(Boolean);
    return parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

function inferMethodName(method: string, path: string): string {
    // Build a name from the path segments + method
    // e.g. GET /users/:id → getUsersById
    // e.g. POST /users → postUsers
    // e.g. DELETE /users/:id → deleteUsersById
    const segments = path.split('/').filter(s => s.length > 0);
    const parts: string[] = [method.toLowerCase()];

    for (const seg of segments) {
        if (seg.startsWith('{')) {
            // {id} → ById, {accountId} → ByAccountId
            const paramName = seg.slice(1, -1);
            parts.push('By' + paramName.charAt(0).toUpperCase() + paramName.slice(1));
        } else {
            // Regular segment — camelCase it
            const segParts = seg.split(/[.-]/).filter(Boolean);
            for (const sp of segParts) {
                parts.push(sp.charAt(0).toUpperCase() + sp.slice(1));
            }
        }
    }

    return parts[0]! + parts.slice(1).join('');
}

// ─── Naming conventions ────────────────────────────────────────────────────

function deriveBaseName(file: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op|ck)$/, '') ?? 'Resource';
    return base
        .split('.')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
}

export function deriveClientClassName(file: string): string {
    return `${deriveBaseName(file)}Client`;
}

export function deriveClientPropertyName(file: string): string {
    const base = deriveBaseName(file);
    return base.charAt(0).toLowerCase() + base.slice(1);
}

// ─── Type collection ──────────────────────────────────────────────────────

function collectTypes(
    root: OpRootNode,
    modelsWithInput?: Set<string>,
    modelsWithOutput?: Set<string>,
    includeInternal = false,
): string[] {
    const types = new Set<string>();
    for (const route of root.routes) {
        const publicOps = route.operations.filter(op => includeInternal || !resolveModifiers(route, op).includes('internal'));
        if (publicOps.length === 0) continue;
        // Only collect path-param types if there are public ops on this route
        collectParamSourceRefs(route.params, types);
        collectParamSourceInputRefs(route.params, types, modelsWithInput);
        for (const op of publicOps) {
            if (op.request) {
                for (const body of op.request.bodies) {
                    collectTypeNodeRefs(body.bodyType, types);
                    collectInputTypeNodeRefs(body.bodyType, types, modelsWithInput);
                }
            }
            for (const resp of op.responses) {
                if (resp.bodyType) {
                    collectTypeNodeRefs(resp.bodyType, types);
                    collectOutputTypeNodeRefs(resp.bodyType, types, modelsWithOutput);
                }
                if (resp.headers) {
                    for (const h of resp.headers) {
                        collectTypeNodeRefs(h.type, types);
                        collectOutputTypeNodeRefs(h.type, types, modelsWithOutput);
                    }
                }
            }
            collectParamSourceRefs(op.query, types);
            collectParamSourceInputRefs(op.query, types, modelsWithInput);
            collectParamSourceRefs(op.headers, types);
            collectParamSourceInputRefs(op.headers, types, modelsWithInput);
        }
    }
    return [...types].sort();
}

/** Collect Output variant refs for response-side ContractTypeNode types. */
function collectOutputTypeNodeRefs(type: ContractTypeNode, out: Set<string>, modelsWithOutput?: Set<string>): void {
    if (!modelsWithOutput) return;
    switch (type.kind) {
        case 'ref':
            if (modelsWithOutput.has(type.name)) out.add(`${type.name}Output`);
            break;
        case 'array':
            collectOutputTypeNodeRefs(type.item, out, modelsWithOutput);
            break;
        case 'intersection':
        case 'union':
        case 'discriminatedUnion':
            type.members.forEach(m => collectOutputTypeNodeRefs(m, out, modelsWithOutput));
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectOutputTypeNodeRefs(f.type, out, modelsWithOutput));
            break;
        case 'lazy':
            collectOutputTypeNodeRefs(type.inner, out, modelsWithOutput);
            break;
    }
}

/** Collect Input variant refs for request-side ParamSource types. */
function collectParamSourceInputRefs(source: ParamSource | undefined, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!source || !modelsWithInput) return;
    if (source.kind === 'ref') {
        if (modelsWithInput.has(source.name)) out.add(`${source.name}Input`);
    } else if (source.kind === 'params') {
        for (const param of source.nodes) {
            collectInputTypeNodeRefs(param.type, out, modelsWithInput);
        }
    } else {
        collectInputTypeNodeRefs(source.node, out, modelsWithInput);
    }
}

/** Collect Input variant refs for request-side ContractTypeNode types. */
function collectInputTypeNodeRefs(type: ContractTypeNode, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!modelsWithInput) return;
    switch (type.kind) {
        case 'ref':
            if (modelsWithInput.has(type.name)) out.add(`${type.name}Input`);
            break;
        case 'array':
            collectInputTypeNodeRefs(type.item, out, modelsWithInput);
            break;
        case 'intersection':
        case 'union':
        case 'discriminatedUnion':
            type.members.forEach(m => collectInputTypeNodeRefs(m, out, modelsWithInput));
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectInputTypeNodeRefs(f.type, out, modelsWithInput));
            break;
        case 'lazy':
            collectInputTypeNodeRefs(type.inner, out, modelsWithInput);
            break;
    }
}

function collectParamSourceRefs(source: ParamSource | undefined, out: Set<string>): void {
    if (!source) return;
    if (source.kind === 'ref') {
        if (/^[A-Z]/.test(source.name)) out.add(source.name);
    } else if (source.kind === 'params') {
        for (const param of source.nodes) {
            collectTypeNodeRefs(param.type, out);
        }
    } else {
        collectTypeNodeRefs(source.node, out);
    }
}

/** True if any emitted operation has query params (drives the `buildQueryString` import). */
function sdkNeedsQueryString(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            if (op.query) return true;
        }
    }
    return false;
}

/** True if any emitted operation serializes a JSON request body (uses bigIntReplacer). */
function sdkNeedsBigIntReplacer(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            if (op.request && op.request.bodies.some(b => isJsonMime(b.contentType))) return true;
        }
    }
    return false;
}

/** True if any public operation parses a JSON response body (uses bigIntReviver). */
function sdkNeedsBigIntReviver(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            if (
                op.responses.some(r => {
                    if (!r.bodyType) return false;
                    // Only JSON-shaped responses use parseJson — text/binary read raw.
                    return !r.contentType || classifyContentType(r.contentType) === 'json';
                })
            ) {
                return true;
            }
        }
    }
    return false;
}

function sdkNeedsJson(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            const check = (src: ParamSource | undefined) => {
                if (!src || src.kind === 'ref') return false;
                if (src.kind === 'params') return src.nodes.some(p => typeNeedsScalar(p.type, 'json'));
                return typeNeedsScalar(src.node, 'json');
            };
            if (
                !!op.request?.bodies.some(b => typeNeedsScalar(b.bodyType, 'json')) ||
                op.responses.some(r => r.bodyType && typeNeedsScalar(r.bodyType, 'json')) ||
                check(op.query) ||
                check(op.headers) ||
                check(route.params)
            )
                return true;
        }
    }
    return false;
}

function collectTypeNodeRefs(type: ContractTypeNode, out: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            if (/^[A-Z]/.test(type.name)) out.add(type.name);
            break;
        case 'array':
            collectTypeNodeRefs(type.item, out);
            break;
        case 'tuple':
            type.items.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'record':
            collectTypeNodeRefs(type.key, out);
            collectTypeNodeRefs(type.value, out);
            break;
        case 'union':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'intersection':
            type.members.forEach(t => collectTypeNodeRefs(t, out));
            break;
        case 'lazy':
            collectTypeNodeRefs(type.inner, out);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectTypeNodeRefs(f.type, out));
            break;
    }
}

// ─── Type import resolution ───────────────────────────────────────────────

function generateTypeImports(types: string[], opFile: string, options: SdkCodegenOptions): string[] {
    const lines: string[] = [];
    const { modelOutPaths, outPath } = options;

    if (modelOutPaths && outPath) {
        const byFile = new Map<string, string[]>();
        const unresolved: string[] = [];

        for (const type of types) {
            const typeOutPath = modelOutPaths.get(type);
            if (typeOutPath) {
                const group = byFile.get(typeOutPath) ?? [];
                group.push(type);
                byFile.set(typeOutPath, group);
            } else {
                unresolved.push(type);
            }
        }

        const fromDir = dirname(outPath);
        for (const [typeOutPath, names] of byFile) {
            let rel = relative(fromDir, typeOutPath);
            rel = rel.replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            lines.push(`import type { ${names.sort().join(', ')} } from '${rel}';`);
        }

        for (const type of unresolved) {
            const moduleName = pascalToDotCase(type);
            lines.push(`import type { ${type} } from './${moduleName}.js';`);
        }
    } else {
        const typeImport = deriveTypeImportPath(opFile, options.typeImportPathTemplate);
        lines.push(`import type { ${types.join(', ')} } from '${typeImport}';`);
    }

    return lines;
}

function deriveTypeImportPath(file: string, template?: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op|ck)$/, '') ?? 'resource';
    const module = base.split('.')[0] ?? base;
    if (template) {
        return template.replace(/\{module\}/g, module).replace(/\{base\}/g, base);
    }
    return `#modules/${module}/types/index.js`;
}

// ─── Shared SDK files ──────────────────────────────────────────────────────

/** Generate the shared SdkOptions interface file. */
export function generateSdkOptions(): string {
    return [
        'export class SdkError extends Error {',
        '    constructor(',
        '        public readonly status: number,',
        '        public readonly statusText: string,',
        '        public readonly body: unknown,',
        '    ) {',
        '        super(`${status} ${statusText}`);',
        "        this.name = 'SdkError';",
        '    }',
        '}',
        '',
        'export type SdkFetch = (url: string, init: RequestInit) => Promise<Response>;',
        '',
        'export interface SdkOptions {',
        '    baseUrl: string;',
        '    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);',
        '    fetch?: SdkFetch;',
        '    /** Called once per request to produce a unique X-Request-ID header value */',
        '    requestIdFactory?: () => string;',
        '}',
        '',
        'export const bigIntReplacer = (_: string, value: any): any => {',
        "    if (typeof value === 'bigint') {",
        "        return value.toString() + 'n';",
        '    }',
        '    return value;',
        '};',
        '',
        'export const bigIntReviver = (_: string, value: any): any => {',
        "    if (typeof value === 'string' && /^-?\\d+n$/.test(value)) {",
        '        return BigInt(value.slice(0, -1));',
        '    }',
        '    return value;',
        '};',
        '',
        JSON_VALUE_TYPE_DECL,
        '',
        'export function createSdkFetch(options: SdkOptions): SdkFetch {',
        '    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());',
        '    return async (url: string, init: RequestInit): Promise<Response> => {',
        "        const baseHeaders = typeof options.headers === 'function'",
        '            ? await options.headers()',
        '            : options.headers ?? {};',
        '        const res = await fetch(`${options.baseUrl}${url}`, {',
        '            ...init,',
        "            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...init.headers as Record<string, string> },",
        '        });',
        '        if (!res.ok) {',
        '            const text = await res.text();',
        '            let body: unknown;',
        '            try { body = JSON.parse(text); } catch { body = text; }',
        '            throw new SdkError(res.status, res.statusText, body);',
        '        }',
        '        return res;',
        '    };',
        '}',
        '',
        'export function buildQueryString(query: object | undefined): string {',
        '    const searchParams = new URLSearchParams();',
        '    if (query) {',
        '        for (const [k, v] of Object.entries(query)) {',
        '            if (v === undefined || v === null) continue;',
        '            if (Array.isArray(v)) { for (const item of v) searchParams.append(k, String(item)); }',
        '            else searchParams.set(k, String(v));',
        '        }',
        '    }',
        '    const qs = searchParams.toString();',
        "    return qs ? `?${qs}` : '';",
        '}',
        '',
        'export async function parseJson<T>(res: Response): Promise<T> {',
        '    return JSON.parse(await res.text(), bigIntReviver) as T;',
        '}',
        '',
    ].join('\n');
}

export interface SdkClientInfo {
    className: string;
    propertyName: string;
    importPath: string;
}

/** Generate the sdk.ts aggregator that wraps all clients into a single Sdk class. */
export function generateSdkAggregator(clients: SdkClientInfo[], sdkOptionsImportPath = './sdk-options.js', sdkClassName = 'Sdk'): string {
    const lines: string[] = [];

    lines.push(`import type { SdkOptions } from '${sdkOptionsImportPath}';`);
    lines.push(`import { createSdkFetch } from '${sdkOptionsImportPath}';`);
    for (const c of clients) {
        lines.push(`import { ${c.className} } from '${c.importPath}';`);
    }
    lines.push('');

    lines.push(`export class ${sdkClassName} {`);
    for (const c of clients) {
        lines.push(`    readonly ${c.propertyName}: ${c.className};`);
    }
    lines.push('');
    lines.push('    constructor(options: SdkOptions) {');
    lines.push('        const sdkFetch = options.fetch ?? createSdkFetch(options);');
    for (const c of clients) {
        lines.push(`        this.${c.propertyName} = new ${c.className}(sdkFetch);`);
    }
    lines.push('    }');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
}
