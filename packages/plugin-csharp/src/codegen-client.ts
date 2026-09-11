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
import { createRenderContext, renderCSharpType, renderFile, type RenderContext } from './codegen-models.js';
import {
    bindCSharpParameterNames,
    deriveCSharpFileBase,
    quoteCSharpString,
    safeMemberName,
    toCSharpParameterName,
    toCSharpPropertyName,
    toCSharpTypeName,
    xmlDocLines,
} from './naming.js';

export interface CSharpClientCodegenOptions {
    namespace: string;
    modelsWithInput: ReadonlySet<string>;
    modelIndex?: ReadonlyMap<string, ModelNode>;
    hoisted?: HoistResult;
    includeInternal?: boolean;
    warn?: (message: string) => void;
}

/**
 * The `using` block every generated client file carries. Fixed for the same reason the models
 * block is: everything a client can name is in the base class library or in the SDK's own two
 * namespaces.
 */
function clientUsings(namespaceName: string): string[] {
    return [
        'using System;',
        'using System.Collections.Generic;',
        'using System.Globalization;',
        'using System.Net.Http;',
        'using System.Numerics;',
        'using System.Text.Json;',
        'using System.Text.Json.Serialization;',
        'using System.Threading;',
        'using System.Threading.Tasks;',
        'using System.Xml;',
        `using ${namespaceName}.Models;`,
        `using ${namespaceName}.Runtime;`,
    ];
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
    return `${deriveCSharpFileBase(file)}Client`;
}

export function deriveClientPropertyName(file: string): string {
    return deriveCSharpFileBase(file);
}

/**
 * Generate the client class for one operations file: one `Task`-returning method per public
 * operation, plus the request and response shapes those methods name.
 */
export function generateCSharpClient(root: OpRootNode, opts: CSharpClientCodegenOptions): string {
    const className = deriveClientClassName(root.file);
    const includeInternal = opts.includeInternal ?? false;
    const ctx = createRenderContext(opts);

    const publicOps: { route: OpRouteNode; op: OpOperationNode }[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            publicOps.push({ route, op });
        }
    }

    // Request and response shapes, emitted after the class: a method's signature names them, and C#
    // does not care about declaration order.
    const shapeLines: string[] = [];
    for (const { route, op } of publicOps) {
        const base = methodBase(deriveMethodName(op, route));
        for (const { source, suffix } of [
            { source: op.query, suffix: 'Query' },
            { source: op.headers, suffix: 'Headers' },
        ]) {
            if (source?.kind !== 'params' || source.nodes.length === 0) continue;
            const shapeName = `${base}${suffix}`;
            shapeLines.push('');
            shapeLines.push(
                ...xmlDocLines(`The ${suffix === 'Query' ? 'query parameters' : 'request headers'} declared on ${where(route, op)}.`, ''),
            );
            shapeLines.push(`public sealed record ${shapeName}`);
            shapeLines.push('{');
            source.nodes.forEach((node, index) => {
                if (index > 0) shapeLines.push('');
                const propName = safeMemberName(toCSharpPropertyName(node.name), shapeName);
                let type = renderCSharpType(node.type, ctx, true);
                const optional = Boolean(node.optional) || node.default !== undefined;
                if (optional && !type.endsWith('?')) type += '?';
                shapeLines.push(`    [JsonPropertyName(${quoteCSharpString(node.name)})]`);
                if (optional) shapeLines.push('    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]');
                shapeLines.push(`    public ${optional ? '' : 'required '}${type} ${propName} { get; init; }`);
            });
            shapeLines.push('}');
        }
        shapeLines.push(...responseDeclarations(route, op, ctx));
    }

    const methodLines: string[] = [];
    const seen = new Map<string, string>();
    for (const { route, op } of publicOps) {
        const methodName = deriveMethodName(op, route);
        const clash = seen.get(methodName);
        if (clash) {
            throw new Error(
                `plugin-csharp: ${where(route, op)} and ${clash} both generate the client method '${methodName}' on ${className}. ` +
                    `Give one of them a distinct 'sdk:' name.`,
            );
        }
        seen.set(methodName, where(route, op));
        methodLines.push('');
        methodLines.push(...generateMethod(route, op, ctx, methodName));
    }

    const body: string[] = [];
    body.push('');
    // The basename, not `root.file`: that is an absolute path on whoever ran the build, and
    // embedding it would make the generated source differ between machines.
    body.push(...xmlDocLines(`Operations declared in <c>${root.file.split('/').pop()}</c>.`, ''));
    body.push(`public sealed class ${className}(SdkHttp http)`);
    body.push('{');
    // `methodLines` opens with a blank separator between methods; the first one sits against the
    // class header, so it is dropped rather than left as a gap.
    body.push(...methodLines.slice(1).map(l => (l === '' ? '' : `    ${l}`)));
    body.push('}');
    body.push(...shapeLines);

    return renderFile(`${opts.namespace}.Clients`, ctx.globalAliases, clientUsings(opts.namespace), body);
}

function where(route: OpRouteNode, op: OpOperationNode): string {
    return `${op.method.toUpperCase()} ${route.path}`;
}

/** The PascalCase stem generated type names hang off: the method name without its `Async` suffix. */
function methodBase(methodName: string): string {
    return methodName.endsWith('Async') ? methodName.slice(0, -'Async'.length) : methodName;
}

// ─── Response shape ────────────────────────────────────────────────────────

/**
 * How a method reports what came back, mirroring the TypeScript, Python and Kotlin SDKs.
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
    const base = methodBase(methodName);
    const shape = responseShape(op);
    const returnType = returnTypeFor(shape, op, base, ctx);
    const observable = observableOf(shape);
    const expectStatuses = observable.filter(r => r.statusCode < 200 || r.statusCode >= 300).map(r => r.statusCode);

    const pathBindings = bindPathParams(route);
    const params = buildMethodParams(route, op, ctx, pathBindings);
    // Everything the body can see by name: a response-header pattern variable must not redeclare one.
    const bound = [...METHOD_LOCALS, ...params.map(p => p.name.replace(/^@/, ''))];
    const signature = [...params.map(p => `${p.type} ${p.name}${p.optional ? ' = null' : ''}`), 'CancellationToken cancellationToken = default'].join(
        ', ',
    );

    const lines: string[] = [];
    lines.push(...methodDoc(route, op, observable));
    if (resolveModifiers(route, op).includes('deprecated')) lines.push('[Obsolete("Deprecated in the contract")]');

    lines.push(`public async ${returnType === 'void' ? 'Task' : `Task<${returnType}>`} ${methodName}(${signature})`);
    lines.push('{');

    const callArgs: string[] = [`HttpMethod.${httpMethodConstant(op.method)}`, buildPathExpression(route.path, route.params, pathBindings)];
    if (op.query) callArgs.push('query: http.Params(query)');
    if (op.headers) callArgs.push('headers: http.Params(customHeaders)');
    const content = bodyArgument(op);
    if (content) callArgs.push(content);
    if (expectStatuses.length > 0) callArgs.push(`expectStatuses: new[] { ${expectStatuses.join(', ')} }`);
    callArgs.push('cancellationToken: cancellationToken');

    const assignment = returnType === 'void' ? 'await ' : 'var response = await ';
    lines.push(`    ${assignment}http.ExecuteAsync(`);
    callArgs.forEach((arg, index) => {
        lines.push(`        ${arg}${index === callArgs.length - 1 ? ').ConfigureAwait(false);' : ','}`);
    });
    lines.push(...returnStatements(shape, op, base, ctx, where(route, op), bound));
    lines.push('}');
    return lines;
}

/** What a method hands back. Declared before the body so the two cannot drift apart. */
function returnTypeFor(shape: ResponseShape, op: OpOperationNode, base: string, ctx: RenderContext): string {
    if (shape.kind !== 'simple') return `${base}Response`;
    const response = shape.response;
    const body = response?.bodies[0];
    const headers = response?.headers ?? [];
    if (!body) return headers.length > 0 ? headersRecordName(op, base) : 'void';
    const dataType = bodyCSharpType(body, ctx);
    // A declared response header changes the return shape: the body alone cannot carry it.
    return headers.length > 0 ? `${base}Result` : dataType;
}

/** The C# type of one response body. A non-JSON mime ignores the schema, as in every SDK. */
function bodyCSharpType(body: OpResponseBodyNode, ctx: RenderContext): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'string';
        case 'binary':
            return 'byte[]';
        default:
            return renderCSharpType(body.bodyType, ctx, false);
    }
}

/** The expression that reads one body out of the response. */
function bodyReadExpr(body: OpResponseBodyNode, ctx: RenderContext): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'response.Text';
        case 'binary':
            return 'response.Bytes';
        default:
            return `http.ReadJson<${renderCSharpType(body.bodyType, ctx, false)}>(response)`;
    }
}

/** The statements after `ExecuteAsync`, which turn the response into the declared return type. */
function returnStatements(
    shape: ResponseShape,
    op: OpOperationNode,
    base: string,
    ctx: RenderContext,
    place: string,
    bound: readonly string[],
): string[] {
    if (shape.kind === 'simple') {
        const response = shape.response;
        const body = response?.bodies[0];
        const headers = response?.headers ?? [];
        if (headers.length === 0) return body ? [`    return ${bodyReadExpr(body, ctx)};`] : [];
        const lines = readHeaderLines(headers, headersRecordName(op, base), ctx, place, '    ', bound);
        return body ? [...lines, `    return new ${base}Result(${bodyReadExpr(body, ctx)}, headers);`] : [...lines, '    return headers;'];
    }

    if (shape.kind === 'multiMime') {
        const headers = shape.response.headers ?? [];
        const lines = headers.length > 0 ? readHeaderLines(headers, headersRecordName(op, base), ctx, place, '    ', bound) : [];
        lines.push(...mimeSwitch(shape.response, base, undefined, ctx, '    ', headers.length > 0));
        return lines;
    }

    // The first declared status is the fall-through, so the switch is exhaustive without a branch
    // for a status the service cannot return.
    const [fallback, ...rest] = shape.responses;
    const lines: string[] = ['    switch (response.Status)', '    {'];
    for (const response of rest) {
        lines.push(`        case ${response.statusCode}:`);
        lines.push('        {');
        lines.push(...statusBranch(response, op, base, response.statusCode, ctx, place, '            ', bound));
        lines.push('        }');
        lines.push('');
    }
    lines.push('        default:');
    lines.push('        {');
    lines.push(...statusBranch(fallback!, op, base, fallback!.statusCode, ctx, place, '            ', bound));
    lines.push('        }');
    lines.push('    }');
    return lines;
}

/**
 * One switch branch: read this status's headers, then dispatch over its mimes.
 *
 * Every branch is braced. Two branches each declaring `headers` would otherwise collide, since a
 * declaration in a switch section is scoped to the whole switch block rather than to its own case.
 */
function statusBranch(
    response: OpResponseNode,
    op: OpOperationNode,
    base: string,
    statusCode: number,
    ctx: RenderContext,
    place: string,
    indent: string,
    bound: readonly string[],
): string[] {
    const lines: string[] = [];
    const headers = response.headers ?? [];
    if (headers.length > 0) lines.push(...readHeaderLines(headers, headersRecordName(op, base, statusCode), ctx, place, indent, bound));
    lines.push(...mimeSwitch(response, base, statusCode, ctx, indent, headers.length > 0));
    return lines;
}

/**
 * Construct the response case, dispatching on the content type when a status declares several
 * mimes. The first declared mime is the fall-through, for the same reason the first status is.
 */
function mimeSwitch(
    response: OpResponseNode,
    base: string,
    statusCode: number | undefined,
    ctx: RenderContext,
    indent: string,
    hasHeaders: boolean,
): string[] {
    const bodies = response.bodies;
    const construct = (body: OpResponseBodyNode | undefined): string => {
        const args: string[] = [];
        if (body) args.push(bodyReadExpr(body, ctx));
        if (hasHeaders) args.push('headers');
        return `new ${base}Response.${leafRecordName(response, body, statusCode)}(${args.join(', ')})`;
    };

    if (bodies.length <= 1) return [`${indent}return ${construct(bodies[0])};`];

    const [fallback, ...rest] = bodies;
    const lines: string[] = [`${indent}switch (response.ContentType)`, `${indent}{`];
    for (const body of rest) {
        lines.push(`${indent}    case ${quoteCSharpString(body.contentType)}:`);
        lines.push(`${indent}        return ${construct(body)};`);
    }
    lines.push(`${indent}    default:`);
    lines.push(`${indent}        return ${construct(fallback!)};`);
    lines.push(`${indent}}`);
    return lines;
}

/** The `content:` argument for the request body, if the operation declares one. */
function bodyArgument(op: OpOperationNode): string | undefined {
    // Only the first declared mime is used, matching the Python and Kotlin SDKs: a method has one
    // signature, and the alternatives describe the same payload in a different encoding.
    const body = op.request?.bodies[0];
    if (!body) return undefined;
    const mime = quoteCSharpString(body.contentType);
    switch (classifyContentType(body.contentType)) {
        case 'multipart':
            return 'content: http.MultipartContent(body)';
        case 'urlencoded':
            return 'content: http.FormContent(body)';
        case 'text':
            return `content: http.TextContent(body, ${mime})`;
        case 'binary':
            return `content: http.BinaryContent(body, ${mime})`;
        default:
            return `content: http.JsonContent(body, ${mime})`;
    }
}

// ─── Response declarations ─────────────────────────────────────────────────

/**
 * The name of a response-headers record: `<Method><Status>Headers` when the status is part of the
 * value, otherwise `<Method>Headers`.
 *
 * The request-headers record claims `<Method>Headers` first, since it is the one a caller builds by
 * name, so an operation that declares both gets `<Method>ResponseHeaders` for its response side.
 * Two records of one name in one namespace is CS0101.
 */
function headersRecordName(op: OpOperationNode, base: string, statusCode?: number): string {
    if (statusCode !== undefined) return `${base}${statusCode}Headers`;
    return declaresRequestHeadersRecord(op) ? `${base}ResponseHeaders` : `${base}Headers`;
}

/** Whether the operation's `headers:` block gets a generated `<Method>Headers` record. */
function declaresRequestHeadersRecord(op: OpOperationNode): boolean {
    return op.headers?.kind === 'params' && op.headers.nodes.length > 0;
}

/**
 * The name of one leaf of a method's response union.
 *
 * Leaves are flat rather than nested per status, so a caller switches in one level. A status with
 * several mimes gets one leaf per mime, keeping the mime and the body type it decodes to
 * correlated.
 */
function leafRecordName(response: OpResponseNode, body: OpResponseBodyNode | undefined, statusCode: number | undefined): string {
    const statusPart = statusCode === undefined ? '' : `Status${statusCode}`;
    if (response.bodies.length <= 1 || !body) return statusPart || 'Body';
    return `${statusPart}${toCSharpTypeName(body.contentType.replace(/[+/.]/g, ' '))}`;
}

/**
 * The `<Method>Headers`, `<Method>Result` and `<Method>Response` declarations a method's return
 * type names. Emitted alongside the client class, since they belong to one method each.
 */
function responseDeclarations(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext): string[] {
    const shape = responseShape(op);
    const base = methodBase(deriveMethodName(op, route));
    const place = where(route, op);
    const lines: string[] = [];

    const headerRecord = (headers: OpResponseHeaderNode[], name: string): void => {
        const parameters = headers
            .map(header => {
                const reader = headerReader(header, place);
                const type = header.optional ? `${reader.type}?` : reader.type;
                return `${type} ${safeMemberName(toCSharpPropertyName(header.name), name)}`;
            })
            .join(', ');
        lines.push('');
        lines.push(...xmlDocLines(`Response headers declared on ${place}.`, ''));
        lines.push(`public sealed record ${name}(${parameters});`);
    };

    if (shape.kind === 'simple') {
        const response = shape.response;
        const headers = response?.headers ?? [];
        if (headers.length === 0) return lines;
        headerRecord(headers, headersRecordName(op, base));
        const body = response?.bodies[0];
        if (body) {
            lines.push('');
            lines.push(...xmlDocLines(`The body of ${place}, with the response headers the contract declares.`, ''));
            lines.push(`public sealed record ${base}Result(${bodyCSharpType(body, ctx)} Data, ${headersRecordName(op, base)} Headers);`);
        }
        return lines;
    }

    const responses = observableOf(shape);
    const withStatus = shape.kind === 'multiStatus';
    for (const response of responses) {
        const headers = response.headers ?? [];
        if (headers.length > 0) headerRecord(headers, headersRecordName(op, base, withStatus ? response.statusCode : undefined));
    }

    lines.push('');
    lines.push(
        ...xmlDocLines(
            `What ${place} returned.\n\n` +
                (withStatus
                    ? 'The operation declares several statuses the service produces, so the status is part of the value.'
                    : 'The status declares several content types, so which one arrived is part of the value.'),
            '',
        ),
    );
    lines.push(`public abstract record ${base}Response`);
    lines.push('{');
    lines.push(`    private ${base}Response() { }`);
    for (const response of responses) {
        const statusCode = withStatus ? response.statusCode : undefined;
        const headers = response.headers ?? [];
        const bodies = response.bodies.length > 0 ? response.bodies : [undefined];
        for (const body of bodies) {
            const name = leafRecordName(response, body, statusCode);
            const parameters: string[] = [];
            if (body) parameters.push(`${bodyCSharpType(body, ctx)} Data`);
            if (headers.length > 0) parameters.push(`${headersRecordName(op, base, statusCode)} Headers`);
            lines.push('');
            lines.push(`    public sealed record ${name}(${parameters.join(', ')}) : ${base}Response;`);
        }
    }
    lines.push('}');
    return lines;
}

/**
 * The C# type of a response header, and how to turn the raw string into it.
 *
 * Header values arrive as text, so the declared type is what the caller gets and the conversion
 * happens here. The accepted set mirrors the other SDKs; anything else is rejected at build time
 * rather than silently handed back as a string.
 *
 * @throws {Error} When the header's declared type cannot be read from an HTTP header.
 */
function headerReader(header: OpResponseHeaderNode, place: string): { type: string; read: (raw: string) => string } {
    const scalar = header.type.kind === 'scalar' ? header.type.name : undefined;
    switch (scalar) {
        case 'string':
        case 'email':
        case 'url':
        case 'interval':
        case 'unknown':
            return { type: 'string', read: raw => raw };
        case 'number':
            return { type: 'double', read: raw => `double.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'int':
            return { type: 'long', read: raw => `long.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'bigint':
            return { type: 'BigInteger', read: raw => `BigInteger.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'boolean':
            return { type: 'bool', read: raw => `${raw} == "true"` };
        case 'uuid':
            return { type: 'Guid', read: raw => `Guid.Parse(${raw})` };
        case 'date':
            return { type: 'DateOnly', read: raw => `DateOnly.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'time':
            return { type: 'TimeOnly', read: raw => `TimeOnly.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'datetime':
            return { type: 'DateTimeOffset', read: raw => `DateTimeOffset.Parse(${raw}, CultureInfo.InvariantCulture)` };
        case 'duration':
            return { type: 'TimeSpan', read: raw => `XmlConvert.ToTimeSpan(${raw})` };
        default:
            throw new Error(
                `plugin-csharp: response header '${header.name}' on ${place} is declared as ${describeHeaderType(header.type)}, ` +
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
function readHeaderLines(
    headers: OpResponseHeaderNode[],
    typeName: string,
    ctx: RenderContext,
    place: string,
    indent: string,
    bound: readonly string[],
): string[] {
    // Pattern variables share the statement's scope, and the method's: each needs a name nothing
    // else in either binds.
    const locals = bindCSharpParameterNames(
        headers.filter(h => h.optional).map(h => h.name),
        bound,
    );
    const args = headers.map(header => {
        const reader = headerReader(header, place);
        const name = quoteCSharpString(header.name);
        // A required header the service omitted is a broken contract, not a null the caller has to
        // handle; an optional one simply stays absent.
        if (!header.optional) return reader.read(`http.RequireHeader(response, ${name})`);
        const local = locals.get(header.name)!;
        return `response.Header(${name}) is { } ${local} ? ${reader.read(local)} : null`;
    });
    const lines: string[] = [`${indent}var headers = new ${typeName}(`];
    args.forEach((arg, index) => lines.push(`${indent}    ${arg}${index === args.length - 1 ? ');' : ','}`));
    return lines;
}

function methodDoc(route: OpRouteNode, op: OpOperationNode, observable: OpResponseNode[]): string[] {
    const lines: string[] = [];
    const parts: string[] = [];
    if (op.name) parts.push(op.name);
    const description = op.description ?? route.description;
    if (description) parts.push(description);
    if (parts.length > 0) lines.push(...xmlDocLines(parts.join('\n'), ''));

    const thrown = op.responses.filter(r => !observable.includes(r)).map(r => r.statusCode);
    if (thrown.length > 0) lines.push(`/// <exception cref="SdkException">On ${thrown.join(', ')}.</exception>`);
    return lines;
}

/** `System.Net.Http.HttpMethod` spells its verbs as `HttpMethod.Get`, `HttpMethod.Delete`, and so on. */
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
 * Render a route path as the `Path(...)` call that builds the URL.
 *
 * Literal segments stay string literals and dynamic ones go through `Segment(...)`, so exactly the
 * values that came from the caller are percent-encoded. `params` says where a value lives: spread
 * across the signature, or behind one `pathParams` argument when the route declares a model.
 */
export function buildPathExpression(path: string, params?: ParamSource, bindings?: ReadonlyMap<string, string>): string {
    const args = path
        .split('/')
        .filter(Boolean)
        .map(raw => {
            PATH_PLACEHOLDER.lastIndex = 0;
            const match = PATH_PLACEHOLDER.exec(raw);
            if (!match || match[0] !== raw) return quoteCSharpString(raw);
            const value =
                params && params.kind !== 'params'
                    ? `pathParams.${toCSharpPropertyName(match[1]!)}`
                    : (bindings?.get(match[1]!) ?? toCSharpParameterName(match[1]!));
            return `http.Segment(${value})`;
        });
    return `http.Path(${args.join(', ')})`;
}

// ─── Parameters ────────────────────────────────────────────────────────────

/**
 * Identifiers a generated method binds or reads besides its path parameters: the other arguments
 * {@link buildMethodParams} can declare, the trailing `CancellationToken`, the locals the body
 * declares, and the client's own `http` constructor parameter. A path parameter under one of these
 * names would duplicate an argument (CS0100), clash with a local (CS0136), or hide `http`.
 */
const METHOD_LOCALS = ['body', 'query', 'customHeaders', 'pathParams', 'cancellationToken', 'response', 'headers', 'http'] as const;

/**
 * The C# parameter name each inline path parameter is spread into the signature under, keyed by its
 * declared name. Keyword-escaped (`@class`), and suffixed when it lands on one of
 * {@link METHOD_LOCALS} (`body_`). Empty when the route has no inline params.
 */
function bindPathParams(route: OpRouteNode): Map<string, string> {
    if (route.params?.kind !== 'params') return new Map();
    return bindCSharpParameterNames(
        route.params.nodes.map(n => n.name),
        METHOD_LOCALS,
    );
}

interface MethodParam {
    name: string;
    type: string;
    optional: boolean;
}

/**
 * The method signature, in the order a caller reads it: path, body, query, headers — but with every
 * required parameter ahead of every optional one.
 *
 * C# rejects a required parameter after an optional one, which Kotlin allows, so the contract's own
 * order cannot always survive. The relative order within each group is kept, and a trailing
 * `CancellationToken` is appended by the caller.
 */
function buildMethodParams(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, pathBindings: ReadonlyMap<string, string>): MethodParam[] {
    const params: MethodParam[] = [];

    if (route.params) {
        if (route.params.kind === 'params') {
            for (const node of route.params.nodes) {
                params.push({ name: pathBindings.get(node.name)!, type: renderCSharpType(node.type, ctx, true), optional: false });
            }
        } else {
            // Not `params`, which is a C# keyword: the argument would have to be written `@params`.
            params.push({ name: 'pathParams', type: renderParamSourceType(route.params, ctx, ''), optional: false });
        }
    }

    const body = op.request?.bodies[0];
    if (body) {
        switch (classifyContentType(body.contentType)) {
            case 'multipart':
                // The caller assembles the parts; the declared contract type describes the fields
                // rather than a value the client can send as one object.
                params.push({ name: 'body', type: 'IEnumerable<SdkPart>', optional: false });
                break;
            case 'binary':
                params.push({ name: 'body', type: 'byte[]', optional: false });
                break;
            case 'text':
                params.push({ name: 'body', type: 'string', optional: false });
                break;
            default:
                params.push({ name: 'body', type: renderCSharpType(body.bodyType, ctx, true), optional: false });
        }
    }

    const base = methodBase(deriveMethodName(op, route));
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

    const widened = params.map(p => (p.optional && !p.type.endsWith('?') ? { ...p, type: `${p.type}?` } : p));
    return [...widened.filter(p => !p.optional), ...widened.filter(p => p.optional)];
}

/** Whether every field of a param source may be omitted, making the whole argument optional. */
function allFieldsOptional(source: ParamSource): boolean {
    if (source.kind !== 'params') return true;
    return source.nodes.every(node => Boolean(node.optional) || node.default !== undefined);
}

function renderParamSourceType(source: ParamSource, ctx: RenderContext, generatedName: string): string {
    if (source.kind === 'ref') return renderCSharpType({ kind: 'ref', name: source.name }, ctx, true);
    if (source.kind === 'type') return renderCSharpType(source.node, ctx, true);
    // The record emitted for this method, or a plain map when the block declares nothing.
    return source.nodes.length > 0 ? generatedName : 'IReadOnlyDictionary<string, string>';
}

// ─── Method naming ─────────────────────────────────────────────────────────

/**
 * The SDK method name, in the same priority order every ContractKit SDK uses: an explicit `sdk:`,
 * then the operation's `name:`, then a name inferred from the verb and path. C# spells it
 * PascalCase with an `Async` suffix, which is what a .NET caller expects of a `Task`-returning
 * method.
 */
export function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return `${toCSharpTypeName(op.sdk)}Async`;
    if (op.name) return `${toCSharpTypeName(op.name)}Async`;
    return `${inferMethodName(op.method, route.path)}Async`;
}

function inferMethodName(method: string, path: string): string {
    const parts = [toCSharpTypeName(method)];
    for (const segment of path.split('/').filter(Boolean)) {
        if (segment.startsWith('{')) parts.push(`By${toCSharpTypeName(segment.slice(1, -1))}`);
        else parts.push(toCSharpTypeName(segment));
    }
    return parts.join('');
}
