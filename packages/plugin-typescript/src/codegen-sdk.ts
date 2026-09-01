import type {
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    OpRequestBodyNode,
    OpResponseNode,
    OpResponseBodyNode,
    OpResponseHeaderNode,
    ContractTypeNode,
    ModelNode,
    ParamSource,
} from '@contractkit/core';
import { resolveModifiers, isJsonMime, classifyContentType, observableResponses, thrownResponses } from '@contractkit/core';
import { renderInputTsType, renderOutputTsType, quoteKey, headerNameToProperty, escapeJsDocLines, sourceLink, JSON_VALUE_TYPE_DECL } from './ts-render.js';
import { pascalToDotCase, typeNeedsScalar } from './codegen-contract.js';
import { bodyTypesStructurallyEqual } from './codegen-operation.js';
import { reviveFnName, renderInlineReviver, typeReachesDecimal, DECIMAL_COERCE_DECL } from './codegen-revive.js';
import { DECIMAL_IMPORT, DECIMAL_CONFIG_LINE } from './decimal-runtime.js';
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

/** Options shared by every SDK code-generation entry point. */
export interface SdkCodegenOptions {
    /** Template for type import paths when `modelOutPaths` is not provided. Supports `{module}` and `{base}`. */
    typeImportPathTemplate?: string;
    /** Absolute path of the file currently being generated. Used to compute relative imports. */
    outPath?: string;
    /** Map from model name → absolute output file path (for cross-module type imports) */
    modelOutPaths?: Map<string, string>;
    /** Absolute path to the shared sdk-options.ts file (if set, imports SdkOptions instead of defining inline) */
    sdkOptionsPath?: string;
    /** Set of model names that have Input variants (models with visibility modifiers) */
    modelsWithInput?: Set<string>;
    /** Set of model names that have Output variants (models with format(output=...)) */
    modelsWithOutput?: Set<string>;
    /** Model names carrying a `decimal`, whose response bodies need rehydrating client-side. */
    modelsWithDecimal?: Set<string>;
    /** Every model in scope, for resolving discriminated-union members inside an inline reviver. */
    modelMap?: Map<string, ModelNode>;
    /**
     * Whether to emit SDK methods for operations marked `internal`. Defaults to `false` —
     * internal ops are omitted from the SDK so consumers don't pick them up. Set to `true`
     * to include them (e.g. for an internal-use SDK).
     */
    includeInternal?: boolean;
    /**
     * Override the generated client class name. When omitted, falls back to
     * `deriveClientClassName(root.file)` (the legacy per-file name). The aggregator
     * uses this to emit `<Area><Subarea>Client` for area+subarea leaf files.
     */
    clientClassName?: string;
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

/**
 * Generate a complete `*.client.ts` file for one operation root: imports, the client class
 * declaration, and one method per public operation. Used for top-level (no-area) files and
 * for subarea-leaf files. Area-level files are NOT routed through this — their methods get
 * inlined into the SDK aggregator via {@link generateClientMethods} + {@link generateSdkAggregator}.
 */
export function generateSdk(root: OpRootNode, options: SdkCodegenOptions = {}): string {
    const lines: string[] = [];
    const includeInternal = options.includeInternal ?? false;

    const types = collectTypes(root, options.modelsWithInput, options.modelsWithOutput, includeInternal);
    const clientClassName = options.clientClassName ?? deriveClientClassName(root.file);

    // The method bodies are generated first so the imports can be read off them, the same way
    // codegen-operation decides its imports from the code it just emitted. A reviver import that
    // came from a predicate instead could drift and leave an unused local behind.
    const inlineRevivers = new Map<string, string[]>();
    const classBody: string[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            const mods = resolveModifiers(route, op);
            if (!includeInternal && mods.includes('internal')) continue;
            classBody.push('');
            classBody.push(...generateMethod(route, op, root.file, options, inlineRevivers));
        }
    }

    const inlineReviverDecls = [...inlineRevivers.values()].flat();
    const decimalPrelude = decimalPreludeFor(inlineReviverDecls);

    // Type-only imports, plus the model revivers the methods actually call.
    if (types.length > 0) {
        lines.push(...generateTypeImports(types, root.file, options, usedRevivers(classBody)));
    }
    lines.push(...decimalPrelude.imports);

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
        if (sdkNeedsReadContentType(root, includeInternal)) valueImports.push('readContentType');
        if (valueImports.length > 0) {
            lines.push(`import { ${valueImports.join(', ')} } from '${rel}';`);
        }
    } else {
        lines.push('');
        lines.push('export class SdkError<TBody = unknown> extends Error {');
        lines.push('    constructor(');
        lines.push('        public readonly status: number,');
        lines.push('        public readonly statusText: string,');
        lines.push('        public readonly body: TBody,');
        lines.push('        public readonly headers: Headers,');
        lines.push('    ) {');
        lines.push('        super(`${status} ${statusText}`);');
        lines.push("        this.name = 'SdkError';");
        lines.push('    }');
        lines.push('}');
        lines.push('');
        lines.push('export interface SdkRequestInit extends RequestInit {');
        lines.push('    /**');
        lines.push('     * Statuses this operation declares as values rather than errors — a 304 from');
        lines.push('     * conditional-GET middleware, or an error status the service returns deliberately.');
        lines.push('     * Anything else at or above 400 still throws SdkError.');
        lines.push('     */');
        lines.push('    expectStatuses?: number[];');
        lines.push('}');
        lines.push('');
        lines.push('export type SdkFetch = (url: string, init: SdkRequestInit) => Promise<Response>;');
        lines.push('');
        lines.push('export interface SdkOptions {');
        lines.push('    baseUrl: string;');
        lines.push('    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);');
        lines.push('    fetch?: SdkFetch;');
        lines.push('    /** Called once per request to produce a unique X-Request-ID header value */');
        lines.push('    requestIdFactory?: () => string;');
        lines.push('}');
        lines.push('');
        lines.push('export function readContentType(res: Response): string {');
        lines.push("    return res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';");
        lines.push('}');
        lines.push('');
        lines.push('export function createSdkFetch(options: SdkOptions): SdkFetch {');
        lines.push('    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());');
        lines.push('    return async (url: string, init: SdkRequestInit): Promise<Response> => {');
        lines.push("        const baseHeaders = typeof options.headers === 'function'");
        lines.push('            ? await options.headers()');
        lines.push('            : options.headers ?? {};');
        lines.push('        const res = await fetch(`${options.baseUrl}${url}`, {');
        lines.push('            ...init,');
        lines.push("            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...init.headers as Record<string, string> },");
        lines.push('        });');
        lines.push('        if (!res.ok && !(init.expectStatuses ?? []).includes(res.status)) {');
        lines.push('            const text = await res.text();');
        lines.push('            let body: unknown;');
        lines.push('            try { body = JSON.parse(text); } catch { body = text; }');
        lines.push('            throw new SdkError(res.status, res.statusText, body, res.headers);');
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

    const errorAliases = generateErrorBodyAliases(root, options);
    if (errorAliases.length > 0) {
        lines.push(...errorAliases);
        lines.push('');
    }

    if (decimalPrelude.decls.length > 0) {
        lines.push('');
        lines.push(...decimalPrelude.decls);
    }

    // Wrappers for bodies with no `reviveX` of their own — an inline object, a record, a tuple.
    for (const decl of inlineRevivers.values()) {
        lines.push('');
        lines.push(...decl);
    }

    // Client class
    lines.push('/**');
    lines.push(` * generated from ${sourceLink(basename(root.file), options.outPath, root.file)}`);
    lines.push(' */');
    lines.push(`export class ${clientClassName} {`);
    lines.push('    constructor(private fetch: SdkFetch) {}');
    lines.push(...classBody);

    lines.push('}');
    lines.push('');

    return lines.join('\n');
}

/**
 * Render the method-block lines for an operation file as if they were declared inside a
 * client class.
 *
 * Skips operations marked `internal` unless `options.includeInternal` is set.
 *
 * @returns `lines`, one consolidated array pre-indented for class-body level with leading blank
 * lines between methods; `methodNames`, used by the caller to detect cross-file collisions when
 * several files contribute to the same area-level client; `preludeLines`, module-level
 * declarations the methods reference (decimal revivers and their `__dec` helper) which the caller
 * must splice in above the class; and `needsDecimalImport`, true when those declarations require
 * `import { Decimal } from 'decimal.js'` in the emitting file.
 */
export function generateClientMethods(
    root: OpRootNode,
    options: SdkCodegenOptions,
): { lines: string[]; methodNames: string[]; preludeLines: string[]; needsDecimalImport: boolean } {
    const lines: string[] = [];
    const methodNames: string[] = [];
    const includeInternal = options.includeInternal ?? false;
    const inlineRevivers = new Map<string, string[]>();
    for (const route of root.routes) {
        for (const op of route.operations) {
            const mods = resolveModifiers(route, op);
            if (!includeInternal && mods.includes('internal')) continue;
            lines.push('');
            lines.push(...generateMethod(route, op, root.file, options, inlineRevivers));
            methodNames.push(deriveMethodName(op, route));
        }
    }
    // Module-level declarations the methods reference, spliced above the class by the caller —
    // the same shape `generateErrorBodyAliases` already uses.
    const declLines = [...inlineRevivers.values()].flat();
    const { decls } = decimalPreludeFor(declLines);
    const preludeLines = [...(decls.length > 0 ? ['', ...decls] : []), ...[...inlineRevivers.values()].flatMap(decl => ['', ...decl])];
    return { lines, methodNames, preludeLines, needsDecimalImport: decls.length > 0 };
}

/**
 * Declarations a client file needs for the inline revivers it carries.
 *
 * An inline wrapper calls `__dec`, which is file-local to the *types* module and not exported, so
 * a client file that has one needs its own copy — along with the decimal.js import and the global
 * config, since nothing else in the file necessarily pulls them in.
 */
function decimalPreludeFor(declLines: string[]): { imports: string[]; decls: string[] } {
    if (!declLines.some(l => l.includes('__dec('))) return { imports: [], decls: [] };
    return { imports: [DECIMAL_IMPORT], decls: [DECIMAL_CONFIG_LINE, '', ...DECIMAL_COERCE_DECL] };
}

/** Model reviver names referenced by generated method bodies. `__revive…` wrappers are local. */
function usedRevivers(lines: string[]): string[] {
    const found = new Set<string>();
    for (const m of lines.join('\n').matchAll(/\brevive[A-Z]\w*/g)) found.add(m[0]);
    return [...found].sort();
}

// ─── Method generation ────────────────────────────────────────────────────

function generateMethod(
    route: OpRouteNode,
    op: OpOperationNode,
    file: string,
    options: SdkCodegenOptions,
    inlineRevivers?: Map<string, string[]>,
): string[] {
    const revive: ReviveContext | undefined =
        options.modelsWithDecimal && options.modelsWithDecimal.size > 0 && inlineRevivers
            ? {
                  modelsWithDecimal: options.modelsWithDecimal,
                  modelsWithOutput: options.modelsWithOutput,
                  modelMap: options.modelMap,
                  inlineRevivers,
                  nameHint: '',
              }
            : undefined;
    const lines: string[] = [];
    const methodName = deriveMethodName(op, route);
    const mRevive = hint(revive, `${methodName.charAt(0).toUpperCase()}${methodName.slice(1)}`);
    const httpMethod = op.method.toUpperCase();
    const { modelsWithInput, modelsWithOutput } = options;

    // Build method parameters (request-side — use Input variants)
    const params = buildMethodParams(route, op, modelsWithInput);
    const paramStr = params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');

    // Determine return type — response side uses Output variants (post-transform wire shape).
    // For non-JSON responses the schema is ignored: text/* is read as string, binary as Blob.
    //
    // `observableResponses` is the client-side mirror of the router's `emittedResponses`: it also
    // covers statuses the service never writes but a client can still receive, such as a 304 from
    // conditional-GET middleware. Anything left over reaches the caller as a thrown SdkError.
    const observable = observableResponses(op);
    const thrown = thrownResponses(op);
    const isMultiStatus = observable.length > 1;
    const primaryResponse = observable[0];
    const primaryBodies = primaryResponse ? primaryResponse.bodies : [];
    const isVoid = primaryBodies.length === 0;
    const respHeaders = primaryResponse?.headers ?? [];
    const hasRespHeaders = respHeaders.length > 0;
    const headersShape = hasRespHeaders ? renderSdkHeadersShape(respHeaders, modelsWithOutput) : '';

    // A union of more than one member is broken across lines — a four-status operation runs to
    // several hundred characters on one line otherwise.
    let returnMembers: string[] | undefined;
    let returnType = '';
    if (isMultiStatus) {
        returnMembers = observable.flatMap(r => sdkResponseMembers(r, modelsWithOutput, true));
    } else if (primaryBodies.length > 1) {
        returnMembers = sdkResponseMembers(primaryResponse!, modelsWithOutput, false);
    } else {
        const dataType = isVoid ? 'void' : sdkDataType(primaryBodies[0]!, modelsWithOutput);
        returnType = hasRespHeaders ? (isVoid ? `{ headers: ${headersShape} }` : `{ data: ${dataType}; headers: ${headersShape} }`) : dataType;
    }
    if (returnMembers?.length === 1) {
        returnType = returnMembers[0]!;
        returnMembers = undefined;
    }

    // Statuses the shared fetch would otherwise reject. All-2xx operations pass nothing, so the
    // overwhelmingly common case keeps its existing call shape.
    const expectStatuses = observable.filter(r => r.statusCode < 200 || r.statusCode >= 300).map(r => r.statusCode);

    // JSDoc
    const desc = op.description ?? route.description;
    const errorBodyName = thrown.some(r => r.bodies.length > 0) ? errorBodyTypeName(route, op) : undefined;
    // `@deprecated` belongs in this block rather than in one of its own: TypeScript honours only
    // the JSDoc comment adjacent to the declaration, so a separate `/** @deprecated */` above a
    // description block is dropped by editors entirely. Tag order mirrors the router's.
    const deprecated = resolveModifiers(route, op).includes('deprecated');
    if (op.name || desc || errorBodyName || deprecated) {
        const tags: string[] = [];
        if (op.name) tags.push(`@name ${op.name}`);
        if (desc) tags.push(`@description ${desc}`);
        if (errorBodyName) tags.push(`@throws {SdkError<${errorBodyName}>} on ${thrown.map(r => r.statusCode).join(', ')}`);
        if (deprecated) tags.push('@deprecated');
        const contentLines = tags.flatMap(t => escapeJsDocLines(t));
        if (contentLines.length === 1) {
            lines.push(`    /** ${contentLines[0]} */`);
        } else {
            lines.push(`    /**`);
            for (const l of contentLines) lines.push(`     * ${l}`);
            lines.push(`     */`);
        }
    }

    if (returnMembers) {
        lines.push(`    async ${methodName}(${paramStr}): Promise<`);
        for (const member of returnMembers) lines.push(`        | ${member}`);
        lines.push(`    > {`);
    } else {
        lines.push(`    async ${methodName}(${paramStr}): Promise<${returnType}> {`);
    }

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

    if (expectStatuses.length > 0) fetchArgs.push(`expectStatuses: [${expectStatuses.join(', ')}]`);

    const needsResult = isMultiStatus || !isVoid || hasRespHeaders;
    const resultPrefix = needsResult ? 'const result = ' : '';
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

    if (isMultiStatus) {
        // The status is only known at runtime, so the caller gets a union to narrow. The lowest
        // status is the default branch, which keeps the function exhaustively returning.
        const [fallback, ...rest] = observable;
        lines.push(`        switch (result.status) {`);
        for (const resp of rest) {
            lines.push(`            case ${resp.statusCode}:`);
            lines.push(...sdkReturnLines(resp, modelsWithOutput, '                ', true, mRevive));
        }
        lines.push(`            default:`);
        lines.push(...sdkReturnLines(fallback!, modelsWithOutput, '                ', true, mRevive));
        lines.push(`        }`);
    } else if (primaryBodies.length > 1) {
        lines.push(...sdkReturnLines(primaryResponse!, modelsWithOutput, '        ', false, mRevive));
    } else if (hasRespHeaders) {
        const headerEntries = sdkHeaderEntries(respHeaders);
        if (isVoid) {
            lines.push(`        return { headers: { ${headerEntries} } };`);
        } else {
            lines.push(`        const data = ${sdkReadExpr(primaryBodies[0]!, modelsWithOutput, hint(mRevive, primaryResponse!.statusCode))};`);
            lines.push(`        return { data, headers: { ${headerEntries} } };`);
        }
    } else if (!isVoid) {
        lines.push(`        return ${sdkReadExpr(primaryBodies[0]!, modelsWithOutput, hint(mRevive, primaryResponse!.statusCode))};`);
    }

    lines.push('    }');

    return lines;
}

// ─── Response shapes ──────────────────────────────────────────────────────

/** The TypeScript type a client sees for one response body. */
function sdkDataType(body: OpResponseBodyNode, modelsWithOutput?: Set<string>): string {
    const category = classifyContentType(body.contentType);
    if (category === 'text') return 'string';
    if (category === 'binary') return 'Blob';
    return renderOutputTsType(body.bodyType, modelsWithOutput);
}

/**
 * How a client reads one response body off the `Response`.
 *
 * A decimal-bearing body is wrapped in its reviver: `parseJson` is a bare cast, so without this the
 * type would say `Decimal` while the runtime held a string. Bodies with no decimal are emitted
 * byte-identically to before.
 */
function sdkReadExpr(body: OpResponseBodyNode, modelsWithOutput?: Set<string>, revive?: ReviveContext): string {
    const category = classifyContentType(body.contentType);
    if (category === 'text') return 'await result.text()';
    if (category === 'binary') return 'await result.blob()';
    const tsType = renderOutputTsType(body.bodyType, modelsWithOutput);
    const read = `await parseJson<${tsType}>(result)`;
    const reviver = reviveExprFor(body.bodyType, revive);
    if (!reviver) return read;
    // `.map` over an array of refs rather than a wrapper function: the reviver returns the same
    // object it mutated, so the mapped array holds the same elements.
    return reviver.kind === 'array' ? `(${read}).map(${reviver.name})` : `${reviver.name}(${read})`;
}

/**
 * Extend the inline-reviver name with one more path segment.
 *
 * Built up compositionally — method, then status, then mime index — because each of those lives in
 * a different function, and the resulting name has to be distinct per body: two operations with
 * different inline decimal bodies must not share one wrapper.
 */
function hint(revive: ReviveContext | undefined, segment: string | number): ReviveContext | undefined {
    if (!revive) return undefined;
    return { ...revive, nameHint: `${revive.nameHint}${segment}` };
}

/** What `sdkReadExpr` needs to decide whether a body has to be revived, and with which function. */
interface ReviveContext {
    modelsWithDecimal: Set<string>;
    modelsWithOutput?: Set<string>;
    /** Inline reviver declarations accumulated for the current file, keyed by function name. */
    inlineRevivers: Map<string, string[]>;
    modelMap?: Map<string, ModelNode>;
    /** Distinguishes the inline wrapper emitted for each body. */
    nameHint: string;
}

/** The reviver to apply to a response body, or `null` when the body holds no decimal. */
function reviveExprFor(bodyType: ContractTypeNode, ctx: ReviveContext | undefined): { name: string; kind: 'value' | 'array' } | null {
    if (!ctx || ctx.modelsWithDecimal.size === 0) return null;
    const opts = { modelsWithDecimal: ctx.modelsWithDecimal, modelsWithOutput: ctx.modelsWithOutput, modelMap: ctx.modelMap };
    if (!typeReachesDecimal(bodyType, opts)) return null;

    const refName = (t: ContractTypeNode): string | null => (t.kind === 'ref' ? t.name : t.kind === 'lazy' ? refName(t.inner) : null);
    const pick = (name: string) => reviveFnName(name, ctx.modelsWithOutput?.has(name) ? 'output' : 'base');

    const direct = refName(bodyType);
    if (direct && ctx.modelsWithDecimal.has(direct)) return { name: pick(direct), kind: 'value' };

    if (bodyType.kind === 'array') {
        const item = refName(bodyType.item);
        if (item && ctx.modelsWithDecimal.has(item)) return { name: pick(item), kind: 'array' };
    }

    // Anything else — an inline object, a record, a tuple — has no `reviveX` to call, so the file
    // gets a wrapper of its own.
    const fnName = `__revive${ctx.nameHint}`;
    if (!ctx.inlineRevivers.has(fnName)) {
        const decl = renderInlineReviver(fnName, renderOutputTsType(bodyType, ctx.modelsWithOutput), bodyType, opts);
        if (!decl) return null;
        ctx.inlineRevivers.set(fnName, decl);
    }
    return { name: fnName, kind: 'value' };
}

function renderSdkHeadersShape(headers: OpResponseHeaderNode[], modelsWithOutput?: Set<string>): string {
    const fields = headers.map(
        h => `${quoteKey(headerNameToProperty(h.name))}${h.optional ? '?' : ''}: ${renderOutputTsType(h.type, modelsWithOutput)}`,
    );
    return `{ ${fields.join('; ')} }`;
}

function sdkHeaderEntries(headers: OpResponseHeaderNode[]): string {
    return headers.map(h => `${quoteKey(headerNameToProperty(h.name))}: result.headers.get('${h.name}') ?? undefined`).join(', ');
}

/**
 * Render one response as the members of the client's return union — the mirror of the router's
 * service-result members, with `data` in place of `body`.
 *
 * Collapses to a single member with a union of mime literals when every declared mime yields the
 * same data type; otherwise one member per mime, so `contentType` and `data` stay correlated.
 */
function sdkResponseMembers(resp: OpResponseNode, modelsWithOutput: Set<string> | undefined, includeStatus: boolean): string[] {
    const bodies = resp.bodies;
    const headers = resp.headers ?? [];
    const leading = includeStatus ? [`status: ${resp.statusCode}`] : [];
    const trailing = headers.length > 0 ? [`headers: ${renderSdkHeadersShape(headers, modelsWithOutput)}`] : [];

    if (bodies.length === 0) {
        return [`{ ${[...leading, ...trailing].join('; ')} }`];
    }

    const dataTypes = bodies.map(b => sdkDataType(b, modelsWithOutput));
    if (dataTypes.every(t => t === dataTypes[0])) {
        const contentType = bodies.map(b => `'${b.contentType}'`).join(' | ');
        return [`{ ${[...leading, `contentType: ${contentType}`, `data: ${dataTypes[0]}`, ...trailing].join('; ')} }`];
    }
    return bodies.map((b, i) => `{ ${[...leading, `contentType: '${b.contentType}'`, `data: ${dataTypes[i]}`, ...trailing].join('; ')} }`);
}

/** The `return` statement(s) that build one response's member of the return union. */
function sdkReturnLines(
    resp: OpResponseNode,
    modelsWithOutput: Set<string> | undefined,
    indent: string,
    includeStatus: boolean,
    revive?: ReviveContext,
): string[] {
    const bodies = resp.bodies;
    const headers = resp.headers ?? [];
    const leading = includeStatus ? [`status: ${resp.statusCode}`] : [];
    const trailing = headers.length > 0 ? [`headers: { ${sdkHeaderEntries(headers)} }`] : [];

    if (bodies.length === 0) {
        return [`${indent}return { ${[...leading, ...trailing].join(', ')} };`];
    }
    if (bodies.length === 1) {
        const fields = [
            ...leading,
            `contentType: '${bodies[0]!.contentType}'`,
            `data: ${sdkReadExpr(bodies[0]!, modelsWithOutput, hint(revive, resp.statusCode))}`,
            ...trailing,
        ];
        return [`${indent}return { ${fields.join(', ')} };`];
    }

    const dataTypes = bodies.map(b => sdkDataType(b, modelsWithOutput));
    if (dataTypes.every(t => t === dataTypes[0])) {
        // Every mime reads the same way, so only the label has to come off the wire.
        const cast = bodies.map(b => `'${b.contentType}'`).join(' | ');
        const fields = [
            ...leading,
            `contentType: readContentType(result) as ${cast}`,
            `data: ${sdkReadExpr(bodies[0]!, modelsWithOutput, hint(revive, resp.statusCode))}`,
            ...trailing,
        ];
        return [`${indent}return { ${fields.join(', ')} };`];
    }

    // The mimes read differently, so the client has to dispatch on what actually came back.
    const lines = [`${indent}switch (readContentType(result)) {`];
    for (const [i, body] of bodies.slice(1).entries()) {
        const fields = [
            ...leading,
            `contentType: '${body.contentType}'`,
            `data: ${sdkReadExpr(body, modelsWithOutput, hint(revive, `${resp.statusCode}_${i + 1}`))}`,
            ...trailing,
        ];
        lines.push(`${indent}    case '${body.contentType}':`);
        lines.push(`${indent}        return { ${fields.join(', ')} };`);
    }
    const first = bodies[0]!;
    const fallbackFields = [
        ...leading,
        `contentType: '${first.contentType}'`,
        `data: ${sdkReadExpr(first, modelsWithOutput, hint(revive, `${resp.statusCode}_0`))}`,
        ...trailing,
    ];
    lines.push(`${indent}    default:`);
    lines.push(`${indent}        return { ${fallbackFields.join(', ')} };`);
    lines.push(`${indent}}`);
    return lines;
}

// ─── Error body typing ────────────────────────────────────────────────────

function errorBodyTypeName(route: OpRouteNode, op: OpOperationNode): string {
    const method = deriveMethodName(op, route);
    return `${method.charAt(0).toUpperCase()}${method.slice(1)}ErrorBody`;
}

/**
 * Module-level `…ErrorBody` aliases for every operation whose thrown statuses declare a body.
 *
 * TypeScript cannot type a `throw`, so the alias plus the method's `@throws` tag is as far as the
 * error contract can be carried: it gives callers something to narrow `SdkError.body` to instead
 * of leaving them with `unknown`.
 */
export function generateErrorBodyAliases(root: OpRootNode, options: SdkCodegenOptions): string[] {
    const includeInternal = options.includeInternal ?? false;
    const lines: string[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            const mods = resolveModifiers(route, op);
            if (!includeInternal && mods.includes('internal')) continue;
            const types = new Set<string>();
            for (const resp of thrownResponses(op)) {
                for (const body of resp.bodies) types.add(sdkDataType(body, options.modelsWithOutput));
            }
            if (types.size === 0) continue;
            lines.push(`export type ${errorBodyTypeName(route, op)} = ${[...types].join(' | ')};`);
        }
    }
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

/** Derive a client class name from a `.ck` file path, e.g. `users.ck` → `UsersClient`. Used for legacy flat (no-area) files. */
export function deriveClientClassName(file: string): string {
    return `${deriveBaseName(file)}Client`;
}

/** Camel-cased property name for a flat client on the SDK aggregator, e.g. `users.ck` → `users`. */
export function deriveClientPropertyName(file: string): string {
    const base = deriveBaseName(file);
    return base.charAt(0).toLowerCase() + base.slice(1);
}

/**
 * Pull `area` / `subarea` from a file's `root.meta` (set via `options { keys: { ... } }`).
 * Both are optional. `area` drives top-level SDK grouping; `subarea` drives nesting under
 * an area's client class.
 */
export function getAreaSubarea(root: OpRootNode): { area?: string; subarea?: string } {
    return { area: root.meta?.area, subarea: root.meta?.subarea };
}

function pascal(value: string): string {
    return value
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
}

function camel(value: string): string {
    const p = pascal(value);
    return p.charAt(0).toLowerCase() + p.slice(1);
}

/** Class name for the area-level client, e.g. `area=identity` → `IdentityClient`. */
export function deriveAreaClientClassName(area: string): string {
    return `${pascal(area)}Client`;
}

/** Property name on the SDK aggregator for an area, e.g. `area=identity` → `identity`. */
export function deriveAreaPropertyName(area: string): string {
    return camel(area);
}

/** Class name for a leaf subarea client, e.g. `(identity, invitations)` → `IdentityInvitationsClient`. */
export function deriveSubareaClientClassName(area: string, subarea: string): string {
    return `${pascal(area)}${pascal(subarea)}Client`;
}

/** Property name on the area client for a subarea, e.g. `subarea=invitations` → `invitations`. */
export function deriveSubareaPropertyName(subarea: string): string {
    return camel(subarea);
}

// ─── Type collection ──────────────────────────────────────────────────────

function collectTypes(root: OpRootNode, modelsWithInput?: Set<string>, modelsWithOutput?: Set<string>, includeInternal = false): string[] {
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
                for (const body of resp.bodies) {
                    collectTypeNodeRefs(body.bodyType, types);
                    collectOutputTypeNodeRefs(body.bodyType, types, modelsWithOutput);
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

/**
 * True if any emitted operation has a status declaring several mimes, so the client has to read
 * the actual content type off the response to know which it got.
 */
function sdkNeedsReadContentType(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            if (observableResponses(op).some(r => r.bodies.length > 1)) return true;
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
            // Only JSON-shaped responses use parseJson — text/binary read raw.
            if (op.responses.some(r => r.bodies.some(b => classifyContentType(b.contentType) === 'json'))) {
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
                op.responses.some(r => r.bodies.some(b => typeNeedsScalar(b.bodyType, 'json'))) ||
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

function generateTypeImports(types: string[], opFile: string, options: SdkCodegenOptions, revivers: string[] = []): string[] {
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
            // Revivers are values, so they need a second, non-type import from the same module.
            const fromHere = revivers.filter(r => modelOutPaths.get(reviverModelName(r, names)) === typeOutPath);
            if (fromHere.length > 0) lines.push(`import { ${fromHere.sort().join(', ')} } from '${rel}';`);
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

/**
 * The model a reviver belongs to. `reviveInvoiceOutput` can come from either `Invoice` (with an
 * `Output` variant) or a model literally called `InvoiceOutput`, so the names actually imported
 * from the module decide it.
 */
function reviverModelName(reviver: string, namesInModule: string[]): string {
    const stem = reviver.replace(/^revive/, '');
    if (namesInModule.includes(stem)) return stem;
    const base = stem.replace(/Output$/, '');
    return namesInModule.includes(base) ? base : stem;
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
        'export class SdkError<TBody = unknown> extends Error {',
        '    constructor(',
        '        public readonly status: number,',
        '        public readonly statusText: string,',
        '        public readonly body: TBody,',
        '        public readonly headers: Headers,',
        '    ) {',
        '        super(`${status} ${statusText}`);',
        "        this.name = 'SdkError';",
        '    }',
        '}',
        '',
        'export interface SdkRequestInit extends RequestInit {',
        '    /**',
        '     * Statuses this operation declares as values rather than errors — a 304 from',
        '     * conditional-GET middleware, or an error status the service returns deliberately.',
        '     * Anything else at or above 400 still throws SdkError.',
        '     */',
        '    expectStatuses?: number[];',
        '}',
        '',
        'export type SdkFetch = (url: string, init: SdkRequestInit) => Promise<Response>;',
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
        'export function readContentType(res: Response): string {',
        "    return res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';",
        '}',
        '',
        'export function createSdkFetch(options: SdkOptions): SdkFetch {',
        '    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());',
        '    return async (url: string, init: SdkRequestInit): Promise<Response> => {',
        "        const baseHeaders = typeof options.headers === 'function'",
        '            ? await options.headers()',
        '            : options.headers ?? {};',
        '        const res = await fetch(`${options.baseUrl}${url}`, {',
        '            ...init,',
        "            headers: { ...baseHeaders, 'X-Request-ID': getRequestId(), ...init.headers as Record<string, string> },",
        '        });',
        '        if (!res.ok && !(init.expectStatuses ?? []).includes(res.status)) {',
        '            const text = await res.text();',
        '            let body: unknown;',
        '            try { body = JSON.parse(text); } catch { body = text; }',
        '            throw new SdkError(res.status, res.statusText, body, res.headers);',
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

// ─── Scaffold files (package.json / tsconfig.json) ─────────────────────────

/** Pinned dependency ranges for scaffolded SDK packages. Kept in one place so they're easy to bump. */
const SCAFFOLD_DEP_VERSIONS = {
    zod: '^4.3.6',
    luxon: '^3.5.0',
    decimalJs: '^10.4.3',
    typesLuxon: '^3.4.2',
    typescript: '^6.0.3',
} as const;

/** Which optional runtime deps the generated SDK references, derived from the contracts it covers. */
export interface SdkScaffoldDeps {
    /** Zod schema files are emitted (`config.zod`) — the SDK imports `zod`. */
    zod: boolean;
    /** Any covered model uses a `date`/`time`/`datetime`/`duration`/`interval` scalar — the SDK imports `luxon`. */
    luxon: boolean;
    /** Any covered model uses a `decimal` scalar — the SDK imports `decimal.js`. */
    decimal: boolean;
}

/**
 * Generate a starter `package.json` for a generated SDK package. Emitted with
 * `ifAbsent` semantics — written once, then owned by the user — so the dependency
 * ranges here are only ever a starting point, never re-applied on later builds.
 */
export function generateSdkPackageJson(input: { name: string; deps: SdkScaffoldDeps }): string {
    const dependencies: Record<string, string> = {};
    if (input.deps.zod) dependencies.zod = SCAFFOLD_DEP_VERSIONS.zod;
    if (input.deps.luxon) dependencies.luxon = SCAFFOLD_DEP_VERSIONS.luxon;
    // No `@types/` half — decimal.js ships its own declarations.
    if (input.deps.decimal) dependencies['decimal.js'] = SCAFFOLD_DEP_VERSIONS.decimalJs;

    const devDependencies: Record<string, string> = { typescript: SCAFFOLD_DEP_VERSIONS.typescript };
    if (input.deps.luxon) devDependencies['@types/luxon'] = SCAFFOLD_DEP_VERSIONS.typesLuxon;

    const pkg = {
        name: input.name,
        version: '0.0.0',
        type: 'module',
        main: './dist/index.js',
        types: './dist/index.d.ts',
        exports: {
            '.': {
                types: './dist/index.d.ts',
                import: './dist/index.js',
            },
        },
        files: ['dist'],
        scripts: {
            build: 'tsc -p tsconfig.json',
        },
        ...(Object.keys(dependencies).length > 0 ? { dependencies } : {}),
        devDependencies,
    };
    return JSON.stringify(pkg, null, 4) + '\n';
}

/**
 * Generate a standalone `tsconfig.json` for a generated SDK package. Deliberately
 * self-contained (no workspace `extends`) so the scaffold works in a freshly
 * `npm init`'d package outside this monorepo. Emitted with `ifAbsent` semantics.
 */
export function generateSdkTsconfig(): string {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            declaration: true,
            outDir: './dist',
            rootDir: './src',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
        },
        include: ['src'],
        exclude: ['dist', 'node_modules'],
    };
    return JSON.stringify(tsconfig, null, 4) + '\n';
}

/**
 * Reference to a per-file leaf client emitted to its own `*.client.ts`. Used by the
 * aggregator to import the class and wire it as either a top-level `sdk.<prop>` or a
 * nested `sdk.<area>.<subarea>` property.
 */
export interface SdkClientInfo {
    /** Client class name (e.g. `UsersClient`, `IdentityInvitationsClient`). */
    className: string;
    /** Property name to expose this client under (e.g. `users`, `invitations`). */
    propertyName: string;
    /** Module specifier for the leaf file, relative to `sdk.ts` and `.js`-suffixed. */
    importPath: string;
}

/**
 * One area-level (no-subarea) `.ck` file whose methods are merged into the area's
 * `<Area>Client` (emitted to its own `<area>.client.ts`).
 */
export interface SdkAreaInlineFile {
    /** Parsed AST. */
    root: OpRootNode;
    /** Codegen options for this file (must have `outPath` pointing at the area client file so type-import paths resolve correctly). */
    codegenOptions: SdkCodegenOptions;
}

/** A grouping of files that share the same `keys.area`. */
export interface SdkAreaInfo {
    area: string;
    /**
     * Reference to the `<Area>Client` class — the file that holds it lives at
     * `client.importPath` (relative to `sdk.ts`) and is generated separately by
     * {@link generateAreaClient}. The aggregator just imports it.
     */
    client: SdkClientInfo;
}

export interface SdkAggregatorInput {
    /** Files with no `keys.area` — kept as flat `Sdk.<filename>` properties (legacy behavior). */
    topLevelClients: SdkClientInfo[];
    /** One entry per `keys.area`. */
    areas: SdkAreaInfo[];
    /** Path to `sdk-options.ts` to import `SdkOptions`/`createSdkFetch`/etc. from. */
    sdkOptionsImportPath?: string;
    /** Name of the top-level aggregator class. Defaults to `Sdk`. */
    sdkClassName?: string;
}

/** Inputs to {@link generateAreaClient}. */
export interface AreaClientInput {
    /** Area name (e.g. `payments`). Drives the generated class name (`PaymentsClient`). */
    area: string;
    /** Output path of the generated `<area>.client.ts` file. Used to resolve relative type / leaf-client / sdk-options imports. */
    outPath: string;
    /** Files contributing inlined methods to the area client (typically area-level files with no subarea). */
    inlineFiles: SdkAreaInlineFile[];
    /** Subarea leaf clients exposed as named properties on the area client. */
    subareaClients: { propertyName: string; client: SdkClientInfo }[];
    /** Path to `sdk-options.ts`, used for `SdkFetch` and runtime helpers. */
    sdkOptionsPath: string;
}

/**
 * Generate a complete `<area>.client.ts` file: the `<Area>Client` class with
 * subarea property fields, a constructor that wires them, and inlined methods
 * merged from every area-level file in `inlineFiles`.
 *
 * Emitted by the plugin alongside the per-leaf `*.client.ts` files. The SDK
 * aggregator just imports the resulting class — see {@link generateSdkAggregator}.
 *
 * @throws if two area-level files contribute the same method name to the area —
 * disambiguate via `sdk:` on the operation, or move one into a subarea.
 */
export function generateAreaClient(input: AreaClientInput): string {
    const { area, outPath, inlineFiles, subareaClients, sdkOptionsPath } = input;
    const className = deriveAreaClientClassName(area);

    // ── Merge inputs across all inline files ────────────────────────────────
    const collectedMethodLines: string[] = [];
    const collectedRevivePrelude: string[] = [];
    let areaNeedsDecimalImport = false;
    /** Reviver value imports, grouped the same way `typesByImportPath` groups the type imports. */
    const reviversByImportPath = new Map<string, Set<string>>();
    // Aliases are keyed off method names, which already collide-check below, so a Set is enough.
    const collectedErrorAliases = new Set<string>();
    const seenMethods = new Set<string>();
    const typesByImportPath = new Map<string, Set<string>>();
    const unresolvedTypes = new Set<string>();
    let needsJson = false;
    let needsBigIntReplacer = false;
    let needsBigIntReviver = false;
    let needsQueryString = false;
    let needsReadContentType = false;

    for (const inline of inlineFiles) {
        const includeInternal = inline.codegenOptions.includeInternal ?? false;
        const { lines: methodLines, methodNames, preludeLines, needsDecimalImport } = generateClientMethods(inline.root, inline.codegenOptions);
        collectedRevivePrelude.push(...preludeLines);
        if (needsDecimalImport) areaNeedsDecimalImport = true;
        for (const name of methodNames) {
            if (seenMethods.has(name)) {
                throw new Error(
                    `[sdk] duplicate method '${name}' in area '${area}': two area-level files contribute the same method. Disambiguate via 'sdk:' or move one into a subarea.`,
                );
            }
            seenMethods.add(name);
        }
        collectedMethodLines.push(...methodLines);
        for (const alias of generateErrorBodyAliases(inline.root, inline.codegenOptions)) collectedErrorAliases.add(alias);
        if (sdkNeedsJson(inline.root, includeInternal)) needsJson = true;
        if (sdkNeedsBigIntReplacer(inline.root, includeInternal)) needsBigIntReplacer = true;
        if (sdkNeedsBigIntReviver(inline.root, includeInternal)) needsBigIntReviver = true;
        if (sdkNeedsQueryString(inline.root, includeInternal)) needsQueryString = true;
        if (sdkNeedsReadContentType(inline.root, includeInternal)) needsReadContentType = true;

        // Revivers this file's methods call, resolved against the same modelOutPaths. Derived from
        // the emitted lines, exactly as `generateSdk` does, so the two paths cannot disagree.
        for (const reviver of usedRevivers(methodLines)) {
            const stem = reviver.replace(/^revive/, '');
            const modelOut = inline.codegenOptions.modelOutPaths?.get(stem) ?? inline.codegenOptions.modelOutPaths?.get(stem.replace(/Output$/, ''));
            if (!modelOut) continue;
            let rel = relative(dirname(outPath), modelOut).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            const set = reviversByImportPath.get(rel) ?? new Set<string>();
            set.add(reviver);
            reviversByImportPath.set(rel, set);
        }

        // Resolve each file's type refs against THIS file's modelOutPaths, but
        // produce import paths relative to the area client's outPath (not the
        // contributing file's outPath, which pointed at the now-defunct sdk.ts).
        const typesForFile = collectTypes(
            inline.root,
            inline.codegenOptions.modelsWithInput,
            inline.codegenOptions.modelsWithOutput,
            includeInternal,
        );
        const { modelOutPaths } = inline.codegenOptions;
        if (modelOutPaths) {
            const fromDir = dirname(outPath);
            for (const t of typesForFile) {
                const typeOutPath = modelOutPaths.get(t);
                if (typeOutPath) {
                    let rel = relative(fromDir, typeOutPath).replace(/\.ts$/, '.js');
                    if (!rel.startsWith('.')) rel = './' + rel;
                    const set = typesByImportPath.get(rel) ?? new Set();
                    set.add(t);
                    typesByImportPath.set(rel, set);
                } else {
                    unresolvedTypes.add(t);
                }
            }
        }
    }

    // ── Imports ─────────────────────────────────────────────────────────────
    let sdkOptionsRel = relative(dirname(outPath), sdkOptionsPath).replace(/\.ts$/, '.js');
    if (!sdkOptionsRel.startsWith('.')) sdkOptionsRel = './' + sdkOptionsRel;

    const lines: string[] = [];
    const jsonImport = needsJson ? ', JsonValue' : '';
    lines.push(`import type { SdkFetch${jsonImport} } from '${sdkOptionsRel}';`);
    const valueImports: string[] = [];
    if (needsBigIntReplacer) valueImports.push('bigIntReplacer');
    if (needsBigIntReviver) valueImports.push('parseJson');
    if (needsQueryString) valueImports.push('buildQueryString');
    if (needsReadContentType) valueImports.push('readContentType');
    if (valueImports.length > 0) {
        lines.push(`import { ${valueImports.join(', ')} } from '${sdkOptionsRel}';`);
    }

    for (const path of [...typesByImportPath.keys()].sort()) {
        const names = [...typesByImportPath.get(path)!].sort();
        lines.push(`import type { ${names.join(', ')} } from '${path}';`);
        const revivers = reviversByImportPath.get(path);
        if (revivers && revivers.size > 0) lines.push(`import { ${[...revivers].sort().join(', ')} } from '${path}';`);
    }
    for (const t of [...unresolvedTypes].sort()) {
        lines.push(`import type { ${t} } from './${pascalToDotCase(t)}.js';`);
    }

    if (areaNeedsDecimalImport) lines.push(DECIMAL_IMPORT);

    // Leaf client imports (subareas only — top-level clients live next to sdk.ts).
    const importedClients = new Set<string>();
    for (const sc of subareaClients) {
        const key = `${sc.client.className}|${sc.client.importPath}`;
        if (importedClients.has(key)) continue;
        importedClients.add(key);
        lines.push(`import { ${sc.client.className} } from '${sc.client.importPath}';`);
    }
    lines.push('');

    if (collectedErrorAliases.size > 0) {
        lines.push(...collectedErrorAliases);
        lines.push('');
    }

    if (collectedRevivePrelude.length > 0) {
        lines.push(...collectedRevivePrelude);
        lines.push('');
    }

    // ── <Area>Client class ──────────────────────────────────────────────────
    lines.push(`export class ${className} {`);
    for (const sc of subareaClients) {
        lines.push(`    readonly ${sc.propertyName}: ${sc.client.className};`);
    }
    if (subareaClients.length > 0) lines.push('');
    if (collectedMethodLines.length > 0 || subareaClients.length > 0) {
        const fetchModifier = collectedMethodLines.length > 0 ? 'private ' : '';
        lines.push(`    constructor(${fetchModifier}fetch: SdkFetch) {`);
        for (const sc of subareaClients) {
            lines.push(`        this.${sc.propertyName} = new ${sc.client.className}(fetch);`);
        }
        lines.push('    }');
    }
    for (const ln of collectedMethodLines) lines.push(ln);
    lines.push('}');
    lines.push('');

    return lines.join('\n');
}

/**
 * Generate the SDK aggregator (`sdk.ts`) — the entry-point file consumers import.
 *
 * Imports every `<Area>Client` (one per area, generated by {@link generateAreaClient}
 * to its own `<area>.client.ts`) and every leaf top-level client, then emits a
 * `class Sdk` that exposes them as properties.
 */
export function generateSdkAggregator(input: SdkAggregatorInput): string {
    const sdkOptionsImportPath = input.sdkOptionsImportPath ?? './sdk-options.js';
    const sdkClassName = input.sdkClassName ?? 'Sdk';

    const lines: string[] = [];
    lines.push(`import type { SdkOptions } from '${sdkOptionsImportPath}';`);
    lines.push(`import { createSdkFetch } from '${sdkOptionsImportPath}';`);

    const importedClients = new Set<string>();
    const pushClientImport = (c: SdkClientInfo): void => {
        const key = `${c.className}|${c.importPath}`;
        if (importedClients.has(key)) return;
        importedClients.add(key);
        lines.push(`import { ${c.className} } from '${c.importPath}';`);
    };
    // Areas first, then top-level — keeps the aggregator's import order stable.
    for (const area of input.areas) pushClientImport(area.client);
    for (const c of input.topLevelClients) pushClientImport(c);
    lines.push('');

    lines.push(`export class ${sdkClassName} {`);
    for (const area of input.areas) {
        lines.push(`    readonly ${deriveAreaPropertyName(area.area)}: ${area.client.className};`);
    }
    for (const c of input.topLevelClients) {
        lines.push(`    readonly ${c.propertyName}: ${c.className};`);
    }
    lines.push('');
    lines.push('    constructor(options: SdkOptions) {');
    lines.push('        const sdkFetch = options.fetch ?? createSdkFetch(options);');
    for (const area of input.areas) {
        lines.push(`        this.${deriveAreaPropertyName(area.area)} = new ${area.client.className}(sdkFetch);`);
    }
    for (const c of input.topLevelClients) {
        lines.push(`        this.${c.propertyName} = new ${c.className}(sdkFetch);`);
    }
    lines.push('    }');
    lines.push('}');
    lines.push('');

    return lines.join('\n');
}
