import type { ModelNode, OpOperationNode, OpResponseNode, OpRootNode, OpRouteNode, ParamSource } from '@contractkit/core';
import { classifyContentType, observableResponses, resolveModifiers } from '@contractkit/core';
import type { HoistResult } from './hoist.js';
import { createRenderContext, quoteKotlinString, renderFile, renderKotlinType, type RenderContext } from './codegen-models.js';
import { deriveKotlinFileBase, escapeKotlinIdentifier, kdocLines, toKotlinPropertyName, toKotlinTypeName } from './naming.js';

export interface KotlinClientCodegenOptions {
    packageName: string;
    modelsWithInput: ReadonlySet<string>;
    modelIndex?: ReadonlyMap<string, ModelNode>;
    hoisted?: HoistResult;
    includeInternal?: boolean;
    warn?: (message: string) => void;
}

/** Whether the root has at least one operation eligible for client emission. */
export function hasPublicOperations(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (includeInternal || !resolveModifiers(route, op).includes('internal')) return true;
        }
    }
    return false;
}

export function deriveClientClassName(file: string): string {
    return `${deriveKotlinFileBase(file)}Client`;
}

export function deriveClientPropertyName(file: string): string {
    const base = deriveKotlinFileBase(file);
    return escapeKotlinIdentifier(base.charAt(0).toLowerCase() + base.slice(1));
}

/**
 * Generate the Ktor client class for one operations file: one `suspend fun` per public operation,
 * plus the request-shape data classes those methods take.
 */
export function generateKotlinClient(root: OpRootNode, opts: KotlinClientCodegenOptions): string {
    const className = deriveClientClassName(root.file);
    const includeInternal = opts.includeInternal ?? false;
    const ctx = createRenderContext({ ...opts, modelsPackage: `${opts.packageName}.models` });
    ctx.imports.add(`${opts.packageName}.runtime.SdkHttp`);

    const publicOps: { route: OpRouteNode; op: OpOperationNode }[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            publicOps.push({ route, op });
        }
    }

    // Request shapes first: a method's signature names them, so they read better above it, and
    // Kotlin does not care about declaration order either way.
    const shapeLines: string[] = [];
    for (const { route, op } of publicOps) {
        const base = toKotlinTypeName(deriveMethodName(op, route));
        for (const { source, suffix } of [
            { source: op.query, suffix: 'Query' },
            { source: op.headers, suffix: 'Headers' },
        ]) {
            if (source?.kind !== 'params' || source.nodes.length === 0) continue;
            ctx.imports.add('kotlinx.serialization.Serializable');
            shapeLines.push('');
            shapeLines.push('@Serializable');
            shapeLines.push(`data class ${base}${suffix}(`);
            for (const node of source.nodes) {
                const propName = toKotlinPropertyName(node.name);
                const wireName = propName.replace(/`/g, '');
                let type = renderKotlinType(node.type, ctx, true);
                const optional = Boolean(node.optional) || node.default !== undefined;
                if (optional && !type.endsWith('?')) type += '?';
                const annotation = wireName !== node.name ? `@SerialName(${quoteKotlinString(node.name)}) ` : '';
                if (annotation) ctx.imports.add('kotlinx.serialization.SerialName');
                shapeLines.push(`    ${annotation}val ${propName}: ${type}${optional ? ' = null' : ''},`);
            }
            shapeLines.push(')');
        }
    }

    const methodLines: string[] = [];
    const seen = new Map<string, string>();
    for (const { route, op } of publicOps) {
        const methodName = deriveMethodName(op, route);
        const where = `${op.method.toUpperCase()} ${route.path}`;
        const clash = seen.get(methodName);
        if (clash) {
            throw new Error(
                `plugin-kotlin: ${where} and ${clash} both generate the client method '${methodName}' on ${className}. ` +
                    `Give one of them a distinct 'sdk:' name.`,
            );
        }
        seen.set(methodName, where);
        methodLines.push('');
        methodLines.push(...generateMethod(route, op, ctx, methodName));
    }

    const body: string[] = [];
    body.push('');
    body.push(...kdocLines(`Operations declared in \`${root.file}\`.`, ''));
    body.push(`class ${className}(private val http: SdkHttp) {`);
    // `methodLines` opens with a blank separator between methods; the first one sits against the
    // class header, so it is dropped rather than left as a gap.
    body.push(...methodLines.slice(1).map(l => (l === '' ? '' : `    ${l}`)));
    body.push('}');
    body.push(...shapeLines);

    return renderFile(`${opts.packageName}.clients`, ctx.imports, body);
}

// ─── Method generation ─────────────────────────────────────────────────────

function generateMethod(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, methodName: string): string[] {
    ctx.imports.add('io.ktor.http.HttpMethod');

    const params = buildMethodParams(route, op, ctx);
    const signature = params.map(p => `${p.name}: ${p.type}${p.optional ? ' = null' : ''}`).join(', ');

    // `observableResponses` is shared with the router and the other SDKs, so all of them agree on
    // which statuses are values and which are failures.
    const observable = observableResponses(op);
    const primary = observable[0];
    const ret = returnShape(primary, ctx);
    const expectStatuses = observable.filter(r => r.statusCode < 200 || r.statusCode >= 300).map(r => r.statusCode);

    const lines: string[] = [];
    lines.push(...methodDoc(route, op, observable));
    const mods = resolveModifiers(route, op);
    if (mods.includes('deprecated')) lines.push('@Deprecated("Deprecated in the contract")');

    const returnSuffix = ret.type === 'Unit' ? '' : `: ${ret.type}`;
    lines.push(`suspend fun ${methodName}(${signature})${returnSuffix} {`);

    const executeArgs = [`HttpMethod.${httpMethodConstant(op.method)}`];
    if (expectStatuses.length > 0) executeArgs.push(`expectStatuses = setOf(${expectStatuses.join(', ')})`);

    const assignment = ret.type === 'Unit' ? '' : 'val response = ';
    lines.push(`    ${assignment}http.execute(${executeArgs.join(', ')}) {`);
    lines.push(`        ${buildPathCall(route.path, route.params)}`);
    if (op.query) lines.push('        params(query)');
    if (op.headers) lines.push('        headers(customHeaders)');
    lines.push(...bodyCall(op, ctx));
    lines.push('    }');
    if (ret.type !== 'Unit') lines.push(`    return ${ret.read}`);
    lines.push('}');
    return lines;
}

interface ReturnShape {
    type: string;
    read: string;
}

/** What a method hands back, and the expression that produces it from the response. */
function returnShape(response: OpResponseNode | undefined, ctx: RenderContext): ReturnShape {
    const body = response?.bodies[0];
    if (!body) return { type: 'Unit', read: '' };
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return { type: 'String', read: 'response.text' };
        case 'binary':
            return { type: 'ByteArray', read: 'response.bytes' };
        default:
            return { type: renderKotlinType(body.bodyType, ctx, false), read: 'http.decodeJson(response)' };
    }
}

/** The lines that set the request body, if the operation declares one. */
function bodyCall(op: OpOperationNode, ctx: RenderContext): string[] {
    // Only the first declared mime is used, matching the Python SDK: a method has one signature,
    // and the alternatives describe the same payload in a different encoding.
    const body = op.request?.bodies[0];
    if (!body) return [];
    const mime = quoteKotlinString(body.contentType);
    switch (classifyContentType(body.contentType)) {
        case 'multipart':
            ctx.imports.add('io.ktor.http.content.PartData');
            return ['        multipartBody(body)'];
        case 'urlencoded':
            return ['        formBody(body)'];
        case 'text':
            return [`        textBody(body, ${mime})`];
        case 'binary':
            return [`        binaryBody(body, ${mime})`];
        default:
            return [`        jsonBody(body, ${mime})`];
    }
}

function methodDoc(route: OpRouteNode, op: OpOperationNode, observable: OpResponseNode[]): string[] {
    const parts: string[] = [];
    if (op.name) parts.push(op.name);
    const description = op.description ?? route.description;
    if (description) parts.push(description);

    const thrown = op.responses.filter(r => !observable.includes(r)).map(r => r.statusCode);
    if (thrown.length > 0) parts.push(`@throws SdkError on ${thrown.join(', ')}`);
    if (parts.length === 0) return [];
    return kdocLines(parts.join('\n'), '');
}

/** Ktor spells its HTTP verbs as `HttpMethod.Get`, `HttpMethod.Delete`, and so on. */
function httpMethodConstant(method: string): string {
    const lower = method.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// ─── Path building ─────────────────────────────────────────────────────────

/**
 * Placeholder names as the `.ck` grammar allows them: `-` and `.` are legal inside one, so a
 * narrower pattern would leave `{payment-id}` in the path and send the braces to the server.
 */
const PATH_PLACEHOLDER = /\{([a-zA-Z_$][a-zA-Z0-9_$.-]*)\}/g;

/**
 * Render a route path as the `path(...)` call that builds the URL.
 *
 * Literal segments stay string literals and dynamic ones go through `segment(...)`, so Ktor
 * percent-encodes exactly the values that came from the caller. `params` says where a value lives:
 * spread across the signature, or behind one `params` argument when the route declares a model.
 */
export function buildPathCall(path: string, params?: ParamSource): string {
    const args = path
        .split('/')
        .filter(Boolean)
        .map(raw => {
            PATH_PLACEHOLDER.lastIndex = 0;
            const match = PATH_PLACEHOLDER.exec(raw);
            if (!match || match[0] !== raw) return quoteKotlinString(raw);
            const prop = toKotlinPropertyName(match[1]!);
            return params && params.kind !== 'params' ? `segment(params.${prop})` : `segment(${prop})`;
        });
    return `path(${args.join(', ')})`;
}

// ─── Parameters ────────────────────────────────────────────────────────────

interface MethodParam {
    name: string;
    type: string;
    optional: boolean;
}

/**
 * The method signature, in the order a caller reads it: path, body, query, headers.
 *
 * Kotlin, unlike Python, allows a required parameter after a defaulted one, so nothing has to be
 * widened or reordered to keep the declaration legal.
 */
function buildMethodParams(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext): MethodParam[] {
    const params: MethodParam[] = [];

    if (route.params) {
        if (route.params.kind === 'params') {
            for (const node of route.params.nodes) {
                params.push({ name: toKotlinPropertyName(node.name), type: renderKotlinType(node.type, ctx, true), optional: false });
            }
        } else {
            params.push({ name: 'params', type: renderParamSourceType(route.params, ctx, ''), optional: false });
        }
    }

    const body = op.request?.bodies[0];
    if (body) {
        switch (classifyContentType(body.contentType)) {
            case 'multipart':
                // Ktor builds a multipart body from parts the caller assembles with `formData { }`;
                // the declared contract type describes the fields, not a value the client can send.
                params.push({ name: 'body', type: 'List<PartData>', optional: false });
                break;
            case 'binary':
                params.push({ name: 'body', type: 'ByteArray', optional: false });
                break;
            case 'text':
                params.push({ name: 'body', type: 'String', optional: false });
                break;
            default:
                params.push({ name: 'body', type: renderKotlinType(body.bodyType, ctx, true), optional: false });
        }
    }

    const base = toKotlinTypeName(deriveMethodName(op, route));
    if (op.query) {
        params.push({ name: 'query', type: renderParamSourceType(op.query, ctx, `${base}Query`), optional: allFieldsOptional(op.query) });
    }
    if (op.headers) {
        params.push({
            name: 'customHeaders',
            type: renderParamSourceType(op.headers, ctx, `${base}Headers`),
            optional: allFieldsOptional(op.headers),
        });
    }

    return params.map(p => (p.optional && !p.type.endsWith('?') ? { ...p, type: `${p.type}?` } : p));
}

/** Whether every field of a param source may be omitted, making the whole argument optional. */
function allFieldsOptional(source: ParamSource): boolean {
    if (source.kind !== 'params') return true;
    return source.nodes.every(node => Boolean(node.optional) || node.default !== undefined);
}

function renderParamSourceType(source: ParamSource, ctx: RenderContext, generatedName: string): string {
    if (source.kind === 'ref') return renderKotlinType({ kind: 'ref', name: source.name }, ctx, true);
    if (source.kind === 'type') return renderKotlinType(source.node, ctx, true);
    // The data class emitted for this method, or an empty map when the block declares nothing.
    return source.nodes.length > 0 ? generatedName : 'Map<String, String>';
}

// ─── Method naming ─────────────────────────────────────────────────────────

/**
 * The SDK method name, in the same priority order every ContractKit SDK uses: an explicit `sdk:`,
 * then the operation's `name:`, then a name inferred from the verb and path. Only the case
 * convention differs between the SDKs.
 */
export function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return escapeKotlinIdentifier(toKotlinMethodName(op.sdk));
    if (op.name) return escapeKotlinIdentifier(toKotlinMethodName(op.name));
    return escapeKotlinIdentifier(inferMethodName(op.method, route.path));
}

function inferMethodName(method: string, path: string): string {
    const parts = [method.toLowerCase()];
    for (const segment of path.split('/').filter(Boolean)) {
        if (segment.startsWith('{')) parts.push(`By${toKotlinTypeName(segment.slice(1, -1))}`);
        else parts.push(toKotlinTypeName(segment));
    }
    return parts.join('');
}

/** camelCase a human-written name: `"Create an Offer"` becomes `createAnOffer`. */
function toKotlinMethodName(name: string): string {
    const pascal = toKotlinTypeName(name);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
