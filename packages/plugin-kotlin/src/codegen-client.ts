import type {
    ModelNode,
    OpOperationNode,
    OpResponseBodyNode,
    OpResponseHeaderNode,
    OpResponseNode,
    OpRootNode,
    OpRouteNode,
    ParamSource,
} from '@contractkit/core';
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
        shapeLines.push(...responseDeclarations(route, op, ctx, deriveMethodName(op, route)));
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
    // The basename, not `root.file`: that is an absolute path on whoever ran the build, and
    // embedding it would make the generated source differ between machines.
    body.push(...kdocLines(`Operations declared in \`${root.file.split('/').pop()}\`.`, ''));
    body.push(`class ${className}(private val http: SdkHttp) {`);
    // `methodLines` opens with a blank separator between methods; the first one sits against the
    // class header, so it is dropped rather than left as a gap.
    body.push(...methodLines.slice(1).map(l => (l === '' ? '' : `    ${l}`)));
    body.push('}');
    body.push(...shapeLines);

    return renderFile(`${opts.packageName}.clients`, ctx.imports, body);
}

// ─── Response shape ────────────────────────────────────────────────────────

/**
 * How a method reports what came back, mirroring the TypeScript and Python SDKs.
 *
 * `simple` is the overwhelmingly common case and returns the body itself. The other two exist
 * because the caller cannot otherwise tell which status, or which mime, it received.
 */
type ResponseShape =
    | { kind: 'simple'; response?: OpResponseNode }
    | { kind: 'multiMime'; response: OpResponseNode }
    | { kind: 'multiStatus'; responses: OpResponseNode[] };

function responseShape(op: OpOperationNode): ResponseShape {
    // `observableResponses` is shared with the router and the other SDKs, so all of them agree on
    // which statuses are values and which are failures.
    const observable = observableResponses(op);
    if (observable.length > 1) return { kind: 'multiStatus', responses: observable };
    const response = observable[0];
    if (response && response.bodies.length > 1) return { kind: 'multiMime', response };
    return { kind: 'simple', response };
}

function observableOf(shape: ResponseShape): OpResponseNode[] {
    if (shape.kind === 'multiStatus') return shape.responses;
    return shape.response ? [shape.response] : [];
}

// ─── Method generation ─────────────────────────────────────────────────────

function generateMethod(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, methodName: string): string[] {
    ctx.imports.add('io.ktor.http.HttpMethod');

    const params = buildMethodParams(route, op, ctx);
    const signature = params.map(p => `${p.name}: ${p.type}${p.optional ? ' = null' : ''}`).join(', ');

    const shape = responseShape(op);
    const base = toKotlinTypeName(methodName.replace(/`/g, ''));
    const where = `${op.method.toUpperCase()} ${route.path}`;
    const returnType = returnTypeFor(shape, base, ctx);
    const observable = observableOf(shape);
    const expectStatuses = observable.filter(r => r.statusCode < 200 || r.statusCode >= 300).map(r => r.statusCode);

    const lines: string[] = [];
    lines.push(...methodDoc(route, op, observable));
    const mods = resolveModifiers(route, op);
    if (mods.includes('deprecated')) lines.push('@Deprecated("Deprecated in the contract")');

    const returnSuffix = returnType === 'Unit' ? '' : `: ${returnType}`;
    lines.push(`suspend fun ${methodName}(${signature})${returnSuffix} {`);

    const executeArgs = [`HttpMethod.${httpMethodConstant(op.method)}`];
    if (expectStatuses.length > 0) executeArgs.push(`expectStatuses = setOf(${expectStatuses.join(', ')})`);

    const assignment = returnType === 'Unit' ? '' : 'val response = ';
    lines.push(`    ${assignment}http.execute(${executeArgs.join(', ')}) {`);
    lines.push(`        ${buildPathCall(route.path, route.params)}`);
    if (op.query) lines.push('        params(query)');
    if (op.headers) lines.push('        headers(customHeaders)');
    lines.push(...bodyCall(op, ctx));
    lines.push('    }');
    lines.push(...returnStatements(shape, base, ctx, where));
    lines.push('}');
    return lines;
}

/** What a method hands back. Declared before the body so the two cannot drift apart. */
function returnTypeFor(shape: ResponseShape, base: string, ctx: RenderContext): string {
    if (shape.kind !== 'simple') return `${base}Response`;
    const response = shape.response;
    const body = response?.bodies[0];
    const headers = response?.headers ?? [];
    if (!body) return headers.length > 0 ? `${base}Headers` : 'Unit';
    const dataType = bodyKotlinType(body, ctx);
    // A declared response header changes the return shape: the body alone cannot carry it.
    return headers.length > 0 ? `${base}Result` : dataType;
}

/** The Kotlin type of one response body. A non-JSON mime ignores the schema, as in every SDK. */
function bodyKotlinType(body: OpResponseBodyNode, ctx: RenderContext): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'String';
        case 'binary':
            return 'ByteArray';
        default:
            return renderKotlinType(body.bodyType, ctx, false);
    }
}

/** The expression that reads one body out of the response. */
function bodyReadExpr(body: OpResponseBodyNode): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'response.text';
        case 'binary':
            return 'response.bytes';
        default:
            return 'http.decodeJson(response)';
    }
}

/** The statements after `execute`, which turn the response into the declared return type. */
function returnStatements(shape: ResponseShape, base: string, ctx: RenderContext, where: string): string[] {
    if (shape.kind === 'simple') {
        const response = shape.response;
        const body = response?.bodies[0];
        const headers = response?.headers ?? [];
        if (headers.length === 0) return body ? [`    return ${bodyReadExpr(body)}`] : [];
        const lines = readHeaderLines(headers, `${base}Headers`, ctx, where, '    ');
        return body ? [...lines, `    return ${base}Result(${bodyReadExpr(body)}, headers)`] : [...lines, '    return headers'];
    }

    const lines: string[] = [];
    if (shape.kind === 'multiMime') {
        lines.push(...mimeBranches(shape.response, base, undefined, ctx, where, '    '));
        return lines;
    }

    // The first declared status is the fall-through, so the `when` is exhaustive without a branch
    // for a status the service cannot return.
    const [fallback, ...rest] = shape.responses;
    lines.push('    return when (response.status.value) {');
    for (const response of rest) {
        lines.push(`        ${response.statusCode} -> {`);
        lines.push(...statusBranch(response, base, response.statusCode, ctx, where, '            '));
        lines.push('        }');
    }
    lines.push('        else -> {');
    lines.push(...statusBranch(fallback!, base, fallback!.statusCode, ctx, where, '            '));
    lines.push('        }');
    lines.push('    }');
    return lines;
}

/** One `when` branch: read this status's headers, then dispatch over its mimes. */
function statusBranch(response: OpResponseNode, base: string, statusCode: number, ctx: RenderContext, where: string, indent: string): string[] {
    const lines: string[] = [];
    const headers = response.headers ?? [];
    if (headers.length > 0) lines.push(...readHeaderLines(headers, headersClassName(base, statusCode), ctx, where, indent));
    lines.push(...mimeBranches(response, base, statusCode, ctx, where, indent, headers.length > 0));
    return lines;
}

/**
 * Construct the response case, dispatching on the content type when a status declares several
 * mimes. The first declared mime is the fall-through, for the same reason the first status is.
 */
function mimeBranches(
    response: OpResponseNode,
    base: string,
    statusCode: number | undefined,
    ctx: RenderContext,
    where: string,
    indent: string,
    hasHeaders = (response.headers?.length ?? 0) > 0,
): string[] {
    const bodies = response.bodies;
    const construct = (body: OpResponseBodyNode | undefined): string => {
        const args: string[] = [];
        if (body) args.push(bodyReadExpr(body));
        if (hasHeaders) args.push('headers');
        const leafName = `${base}Response.${leafClassName(response, body, statusCode)}`;
        return args.length > 0 ? `${leafName}(${args.join(', ')})` : leafName;
    };

    const prefix = statusCode === undefined ? 'return ' : '';
    if (bodies.length <= 1) {
        if (statusCode !== undefined && (response.headers?.length ?? 0) === 0) {
            // A bodiless, headerless status is a `data object`, which needs no construction.
            return [`${indent}${construct(bodies[0])}`];
        }
        return [`${indent}${prefix}${construct(bodies[0])}`];
    }

    const lines: string[] = [];
    const [fallback, ...rest] = bodies;
    lines.push(`${indent}${prefix}when (response.contentType) {`);
    for (const body of rest) {
        lines.push(`${indent}    ${quoteKotlinString(body.contentType)} -> ${construct(body)}`);
    }
    lines.push(`${indent}    else -> ${construct(fallback!)}`);
    lines.push(`${indent}}`);
    return lines;
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

// ─── Response declarations ─────────────────────────────────────────────────

function headersClassName(base: string, statusCode?: number): string {
    return statusCode === undefined ? `${base}Headers` : `${base}${statusCode}Headers`;
}

/**
 * The name of one leaf of a method's sealed response.
 *
 * Leaves are flat rather than nested per status, so a caller's `when` stays exhaustive in one
 * level. A status with several mimes gets one leaf per mime, keeping the mime and the body type
 * it decodes to correlated.
 */
function leafClassName(response: OpResponseNode, body: OpResponseBodyNode | undefined, statusCode: number | undefined): string {
    const statusPart = statusCode === undefined ? '' : `Status${statusCode}`;
    if (response.bodies.length <= 1 || !body) return statusPart || 'Body';
    return `${statusPart}${toKotlinTypeName(body.contentType.replace(/[+/.]/g, ' '))}`;
}

/**
 * The `<Method>Headers`, `<Method>Result`, and `<Method>Response` declarations a method's return
 * type names. Emitted alongside the client class, since they belong to one method each.
 */
function responseDeclarations(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, methodName: string): string[] {
    const shape = responseShape(op);
    const base = toKotlinTypeName(methodName.replace(/`/g, ''));
    const where = `${op.method.toUpperCase()} ${route.path}`;
    const lines: string[] = [];

    const headerClass = (headers: OpResponseHeaderNode[], name: string): void => {
        lines.push('');
        lines.push(...kdocLines(`Response headers declared on ${where}.`, ''));
        lines.push(`data class ${name}(`);
        for (const header of headers) {
            const reader = headerReader(header, ctx, where);
            const type = header.optional ? `${reader.type}?` : reader.type;
            lines.push(`    val ${toKotlinPropertyName(header.name)}: ${type},`);
        }
        lines.push(')');
    };

    if (shape.kind === 'simple') {
        const response = shape.response;
        const headers = response?.headers ?? [];
        if (headers.length === 0) return lines;
        headerClass(headers, headersClassName(base));
        const body = response?.bodies[0];
        if (body) {
            lines.push('');
            lines.push(...kdocLines(`The body of ${where}, with the response headers the contract declares.`, ''));
            lines.push(`data class ${base}Result(`);
            lines.push(`    val data: ${bodyKotlinType(body, ctx)},`);
            lines.push(`    val headers: ${headersClassName(base)},`);
            lines.push(')');
        }
        return lines;
    }

    const responses = observableOf(shape);
    const withStatus = shape.kind === 'multiStatus';
    for (const response of responses) {
        const headers = response.headers ?? [];
        if (headers.length > 0) headerClass(headers, headersClassName(base, withStatus ? response.statusCode : undefined));
    }

    lines.push('');
    lines.push(
        ...kdocLines(
            `What ${where} returned.\n\n` +
                (withStatus
                    ? 'The operation declares several statuses the service produces, so the status is part of the value.'
                    : 'The status declares several content types, so which one arrived is part of the value.'),
            '',
        ),
    );
    lines.push(`sealed interface ${base}Response {`);
    for (const response of responses) {
        const statusCode = withStatus ? response.statusCode : undefined;
        const headers = response.headers ?? [];
        const headerProp = headers.length > 0 ? `    val headers: ${headersClassName(base, statusCode)},` : undefined;
        const bodies = response.bodies.length > 0 ? response.bodies : [undefined];
        for (const body of bodies) {
            const name = leafClassName(response, body, statusCode);
            if (!body && !headerProp) {
                lines.push(`    data object ${name} : ${base}Response`);
                continue;
            }
            lines.push(`    data class ${name}(`);
            if (body) lines.push(`        val data: ${bodyKotlinType(body, ctx)},`);
            if (headerProp) lines.push(`    ${headerProp.trim()}`);
            lines.push(`    ) : ${base}Response`);
        }
    }
    lines.push('}');
    return lines;
}

/**
 * The Kotlin type of a response header, and how to turn the raw string into it.
 *
 * Header values arrive as text, so the declared type is what the caller gets and the conversion
 * happens here. The accepted set mirrors the TypeScript and Python SDKs; anything else is rejected
 * at build time rather than silently handed back as a string.
 *
 * @throws {Error} When the header's declared type cannot be read from an HTTP header.
 */
function headerReader(header: OpResponseHeaderNode, ctx: RenderContext, where: string): { type: string; read: (raw: string) => string } {
    const scalar = header.type.kind === 'scalar' ? header.type.name : undefined;
    switch (scalar) {
        case 'string':
        case 'email':
        case 'url':
        case 'interval':
        case 'unknown':
            return { type: 'String', read: raw => raw };
        case 'number':
            return { type: 'Double', read: raw => `${raw}.toDouble()` };
        case 'int':
            return { type: 'Long', read: raw => `${raw}.toLong()` };
        case 'bigint':
            ctx.imports.add(`${ctx.packageName}.runtime.BigInt`);
            return { type: 'BigInt', read: raw => `BigInt(${raw})` };
        case 'boolean':
            return { type: 'Boolean', read: raw => `${raw} == "true"` };
        case 'uuid':
            ctx.imports.addOptIn('ExperimentalUuidApi', 'kotlin.uuid.ExperimentalUuidApi');
            ctx.imports.add('kotlin.uuid.Uuid');
            return { type: 'Uuid', read: raw => `Uuid.parse(${raw})` };
        case 'date':
            ctx.imports.add('kotlinx.datetime.LocalDate');
            return { type: 'LocalDate', read: raw => `LocalDate.parse(${raw})` };
        case 'time':
            ctx.imports.add('kotlinx.datetime.LocalTime');
            return { type: 'LocalTime', read: raw => `LocalTime.parse(${raw})` };
        case 'datetime':
            ctx.imports.add('kotlin.time.Instant');
            return { type: 'Instant', read: raw => `Instant.parse(${raw})` };
        case 'duration':
            ctx.imports.add('kotlin.time.Duration');
            return { type: 'Duration', read: raw => `Duration.parseIsoString(${raw})` };
        default:
            throw new Error(
                `plugin-kotlin: response header '${header.name}' on ${where} is declared as ${describeHeaderType(header.type)}, ` +
                    `which cannot be read from an HTTP header. Header values arrive as strings — declare it as string, email, url, uuid, ` +
                    `date, time, datetime, duration, interval, int, number, boolean or bigint.`,
            );
    }
}

/** A short, contract-facing description of a header type, for the rejection above. */
function describeHeaderType(type: { kind: string; name?: string }): string {
    if (type.kind === 'scalar') return `the '${type.name}' scalar`;
    if (type.kind === 'ref') return `the contract '${type.name}'`;
    return `${type.kind === 'array' || type.kind === 'inlineObject' ? 'an' : 'a'} ${type.kind}`;
}

/** The lines that build one response-headers value out of the response. */
function readHeaderLines(headers: OpResponseHeaderNode[], typeName: string, ctx: RenderContext, where: string, indent: string): string[] {
    const lines: string[] = [`${indent}val headers = ${typeName}(`];
    for (const header of headers) {
        const reader = headerReader(header, ctx, where);
        const name = quoteKotlinString(header.name);
        // A required header the service omitted is a broken contract, not a null the caller has to
        // handle; an optional one simply stays absent.
        const expr = header.optional
            ? `response.headers[${name}]?.let { ${reader.read('it')} }`
            : reader.read(`http.requireHeader(response, ${name})`);
        lines.push(`${indent}    ${expr},`);
    }
    lines.push(`${indent})`);
    return lines;
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
