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
import { createRenderContext, renderFile, renderSwiftType, type RenderContext } from './codegen-models.js';
import {
    bindSwiftParameterNames,
    deriveSwiftFileBase,
    docLines,
    escapeSwiftIdentifier,
    quoteSwiftString,
    toSwiftCaseName,
    toSwiftPropertyName,
    toSwiftTypeName,
} from './naming.js';

export interface SwiftClientCodegenOptions {
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
    return `${deriveSwiftFileBase(file)}Client`;
}

export function deriveClientPropertyName(file: string): string {
    const base = deriveSwiftFileBase(file);
    return escapeSwiftIdentifier(base.charAt(0).toLowerCase() + base.slice(1));
}

/**
 * Generate the client class for one operations file: one `async throws` method per public
 * operation, plus the request and response shapes those methods name.
 */
export function generateSwiftClient(root: OpRootNode, opts: SwiftClientCodegenOptions): string {
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

    const methodLines: string[] = [];
    const seen = new Map<string, string>();
    for (const { route, op } of publicOps) {
        const methodName = deriveMethodName(op, route);
        const where = `${op.method.toUpperCase()} ${route.path}`;
        const clash = seen.get(methodName);
        if (clash) {
            throw new Error(
                `plugin-swift: ${where} and ${clash} both generate the client method '${methodName}' on ${className}. ` +
                    `Give one of them a distinct 'sdk:' name.`,
            );
        }
        seen.set(methodName, where);
        methodLines.push('');
        methodLines.push(...generateMethod(route, op, ctx, methodName));
    }

    // Request and response shapes follow the class: a method's signature names them, and Swift
    // does not care about declaration order.
    const shapeLines: string[] = [];
    for (const { route, op } of publicOps) {
        const base = toSwiftTypeName(deriveMethodName(op, route).replace(/`/g, ''));
        const where = `${op.method.toUpperCase()} ${route.path}`;
        for (const { source, suffix, what } of [
            { source: op.query, suffix: 'Query', what: 'Query parameters' },
            { source: op.headers, suffix: 'Headers', what: 'Request headers' },
        ]) {
            if (source?.kind !== 'params' || source.nodes.length === 0) continue;
            shapeLines.push('', ...paramStruct(`${base}${suffix}`, source, ctx, `${what} for ${where}.`));
        }
        shapeLines.push(...responseDeclarations(route, op, ctx, deriveMethodName(op, route)));
    }

    const body: string[] = [];
    body.push('');
    // The basename, not `root.file`: that is an absolute path on whoever ran the build, and
    // embedding it would make the generated source differ between machines.
    body.push(...docLines(`Operations declared in \`${root.file.split('/').pop()}\`.`, ''));
    body.push(`public final class ${className}: Sendable {`);
    body.push('    private let http: SdkHttp');
    body.push('');
    body.push('    public init(http: SdkHttp) {');
    body.push('        self.http = http');
    body.push('    }');
    body.push(...methodLines.map(l => (l === '' ? '' : `    ${l}`)));
    body.push('}');
    body.push(...shapeLines);

    return renderFile(body);
}

/** A `params` block as an `Encodable` struct the runtime flattens into the query or the headers. */
function paramStruct(name: string, source: ParamSource & { kind: 'params' }, ctx: RenderContext, doc: string): string[] {
    const fields = source.nodes.map(node => {
        const type = renderSwiftType(node.type, ctx, true);
        const optional = Boolean(node.optional) || node.default !== undefined;
        return { propName: toSwiftPropertyName(node.name), wireName: node.name, type: optional && !type.endsWith('?') ? `${type}?` : type, optional };
    });

    const lines: string[] = [];
    lines.push(...docLines(doc, ''));
    lines.push(`public struct ${name}: Encodable, Equatable, Sendable {`);
    for (const f of fields) lines.push(`    public var ${f.propName}: ${f.type}`);
    lines.push('');
    lines.push(`    public init(${fields.map(f => `${f.propName}: ${f.type}${f.optional ? ' = nil' : ''}`).join(', ')}) {`);
    for (const f of fields) lines.push(`        self.${f.propName} = ${f.propName}`);
    lines.push('    }');
    lines.push('');
    lines.push('    private enum CodingKeys: String, CodingKey {');
    for (const f of fields) lines.push(`        case ${f.propName} = ${quoteSwiftString(f.wireName)}`);
    lines.push('    }');
    lines.push('}');
    return lines;
}

// ─── Response shape ────────────────────────────────────────────────────────

/**
 * How a method reports what came back, mirroring the TypeScript, Python, and Kotlin SDKs.
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
    const pathBindings = bindPathParams(route);
    const params = buildMethodParams(route, op, ctx, pathBindings);
    const signature = params.map(p => `${p.name}: ${p.type}${p.optional ? ' = nil' : ''}`).join(', ');

    const shape = responseShape(op);
    const base = toSwiftTypeName(methodName.replace(/`/g, ''));
    const where = `${op.method.toUpperCase()} ${route.path}`;
    const returnType = returnTypeFor(shape, op, base, ctx);
    const observable = observableOf(shape);
    const expectStatuses = observable.filter(r => r.statusCode < 200 || r.statusCode >= 300).map(r => r.statusCode);

    const lines: string[] = [];
    lines.push(...methodDoc(route, op, observable));
    const mods = resolveModifiers(route, op);
    if (mods.includes('deprecated')) lines.push('@available(*, deprecated, message: "Deprecated in the contract")');

    const returnSuffix = returnType === 'Void' ? '' : ` -> ${returnType}`;
    lines.push(`public func ${methodName}(${signature}) async throws${returnSuffix} {`);

    const setup: string[] = [];
    if (op.query) setup.push('try http.addQuery(&request, query)');
    if (op.headers) setup.push('try http.addHeaders(&request, customHeaders)');
    setup.push(...bodyCall(op));

    const path = buildPathSegments(route.path, route.params, pathBindings);
    // `try` goes in front of the whole initializer when a segment throws, so it covers every
    // element of the literal; a request nothing mutates is a `let`, which keeps the compiler quiet.
    const declaration = setup.length > 0 ? 'var' : 'let';
    lines.push(
        `    ${declaration} request = ${path.throws ? 'try ' : ''}SdkRequest(method: ${quoteSwiftString(op.method.toUpperCase())}, path: [${path.segments.join(', ')}])`,
    );
    lines.push(...setup.map(l => `    ${l}`));

    const executeArgs = ['request'];
    if (expectStatuses.length > 0) executeArgs.push(`expectStatuses: [${expectStatuses.join(', ')}]`);
    const assignment = returnType === 'Void' ? '_ = ' : 'let response = ';
    lines.push(`    ${assignment}try await http.execute(${executeArgs.join(', ')})`);
    lines.push(...returnStatements(shape, op, base, ctx, where));
    lines.push('}');
    return lines;
}

/** What a method hands back. Declared before the body so the two cannot drift apart. */
function returnTypeFor(shape: ResponseShape, op: OpOperationNode, base: string, ctx: RenderContext): string {
    if (shape.kind !== 'simple') return `${base}Response`;
    const response = shape.response;
    const body = response?.bodies[0];
    const headers = response?.headers ?? [];
    if (!body) return headers.length > 0 ? headersStructName(op, base) : 'Void';
    const dataType = bodySwiftType(body, ctx);
    // A declared response header changes the return shape: the body alone cannot carry it.
    return headers.length > 0 ? `${base}Result` : dataType;
}

/** The Swift type of one response body. A non-JSON mime ignores the schema, as in every SDK. */
function bodySwiftType(body: OpResponseBodyNode, ctx: RenderContext): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'String';
        case 'binary':
            return 'Data';
        default:
            return renderSwiftType(body.bodyType, ctx, false);
    }
}

/** The expression that reads one body out of the response. */
function bodyReadExpr(body: OpResponseBodyNode, ctx: RenderContext): string {
    switch (classifyContentType(body.contentType)) {
        case 'text':
            return 'response.text';
        case 'binary':
            return 'response.body';
        default:
            return `try http.decodeJSON(${bodySwiftType(body, ctx)}.self, from: response)`;
    }
}

/** The statements after `execute`, which turn the response into the declared return type. */
function returnStatements(shape: ResponseShape, op: OpOperationNode, base: string, ctx: RenderContext, where: string): string[] {
    if (shape.kind === 'simple') {
        const response = shape.response;
        const body = response?.bodies[0];
        const headers = response?.headers ?? [];
        if (headers.length === 0) return body ? [`    return ${bodyReadExpr(body, ctx)}`] : [];
        const lines = readHeaderLines(headers, headersStructName(op, base), where, '    ');
        return body ? [...lines, `    return ${base}Result(data: ${bodyReadExpr(body, ctx)}, headers: headers)`] : [...lines, '    return headers'];
    }

    if (shape.kind === 'multiMime') return mimeBranches(shape.response, base, undefined, ctx, where, '    ');

    // The first declared status is the fall-through, so the `switch` is exhaustive without a
    // branch for a status the service cannot return.
    const [fallback, ...rest] = shape.responses;
    const lines: string[] = ['    switch response.status {'];
    for (const response of rest) {
        lines.push(`    case ${response.statusCode}:`);
        lines.push(...statusBranch(response, op, base, response.statusCode, ctx, where, '        '));
    }
    lines.push('    default:');
    lines.push(...statusBranch(fallback!, op, base, fallback!.statusCode, ctx, where, '        '));
    lines.push('    }');
    return lines;
}

/** One `switch` branch: read this status's headers, then dispatch over its mimes. */
function statusBranch(
    response: OpResponseNode,
    op: OpOperationNode,
    base: string,
    statusCode: number,
    ctx: RenderContext,
    where: string,
    indent: string,
): string[] {
    const lines: string[] = [];
    const headers = response.headers ?? [];
    if (headers.length > 0) lines.push(...readHeaderLines(headers, headersStructName(op, base, statusCode), where, indent));
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
        const caseName = `.${leafCaseName(response, body, statusCode)}`;
        if (body && hasHeaders) return `${caseName}(data: ${bodyReadExpr(body, ctx)}, headers: headers)`;
        if (body) return `${caseName}(${bodyReadExpr(body, ctx)})`;
        if (hasHeaders) return `${caseName}(headers: headers)`;
        return caseName;
    };

    if (bodies.length <= 1) return [`${indent}return ${construct(bodies[0])}`];

    const lines: string[] = [];
    const [fallback, ...rest] = bodies;
    lines.push(`${indent}switch response.contentType {`);
    for (const body of rest) {
        lines.push(`${indent}case ${quoteSwiftString(body.contentType.toLowerCase())}:`);
        lines.push(`${indent}    return ${construct(body)}`);
    }
    lines.push(`${indent}default:`);
    lines.push(`${indent}    return ${construct(fallback!)}`);
    lines.push(`${indent}}`);
    return lines;
}

/** The line that sets the request body, if the operation declares one. */
function bodyCall(op: OpOperationNode): string[] {
    // Only the first declared mime is used, matching the Python and Kotlin SDKs: a method has one
    // signature, and the alternatives describe the same payload in a different encoding.
    const body = op.request?.bodies[0];
    if (!body) return [];
    const mime = quoteSwiftString(body.contentType);
    switch (classifyContentType(body.contentType)) {
        case 'multipart':
            return ['http.setMultipartBody(&request, body)'];
        case 'urlencoded':
            return [`try http.setFormBody(&request, body, contentType: ${mime})`];
        case 'text':
            return [`http.setTextBody(&request, body, contentType: ${mime})`];
        case 'binary':
            return [`http.setBinaryBody(&request, body, contentType: ${mime})`];
        default:
            return [`try http.setJSONBody(&request, body, contentType: ${mime})`];
    }
}

// ─── Response declarations ─────────────────────────────────────────────────

/**
 * The name of a response-headers struct: `<Method><Status>Headers` when the status is part of the
 * value, otherwise `<Method>Headers`.
 *
 * The request-headers struct claims `<Method>Headers` first, since it is the one a caller builds by
 * name, so an operation that declares both gets `<Method>ResponseHeaders` for its response side.
 * Two structs of one name in one module is an invalid redeclaration.
 */
function headersStructName(op: OpOperationNode, base: string, statusCode?: number): string {
    if (statusCode !== undefined) return `${base}${statusCode}Headers`;
    return declaresRequestHeadersStruct(op) ? `${base}ResponseHeaders` : `${base}Headers`;
}

/** Whether the operation's `headers:` block gets a generated `<Method>Headers` struct. */
function declaresRequestHeadersStruct(op: OpOperationNode): boolean {
    return op.headers?.kind === 'params' && op.headers.nodes.length > 0;
}

/**
 * The name of one case of a method's response enum.
 *
 * Cases are flat rather than nested per status, so a caller's `switch` stays exhaustive in one
 * level. A status with several mimes gets one case per mime, keeping the mime and the body type it
 * decodes to correlated.
 */
function leafCaseName(response: OpResponseNode, body: OpResponseBodyNode | undefined, statusCode: number | undefined): string {
    const statusPart = statusCode === undefined ? '' : `Status${statusCode}`;
    if (response.bodies.length <= 1 || !body) return toSwiftCaseName(statusPart || 'Body');
    return toSwiftCaseName(`${statusPart}${toSwiftTypeName(body.contentType.replace(/[+/.]/g, ' '))}`);
}

/**
 * The `<Method>Headers`, `<Method>Result`, and `<Method>Response` declarations a method's return
 * type names. Emitted alongside the client class, since they belong to one method each.
 */
function responseDeclarations(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, methodName: string): string[] {
    const shape = responseShape(op);
    const base = toSwiftTypeName(methodName.replace(/`/g, ''));
    const where = `${op.method.toUpperCase()} ${route.path}`;
    const lines: string[] = [];

    const headerStruct = (headers: OpResponseHeaderNode[], name: string): void => {
        const fields = headers.map(header => {
            const type = headerSwiftType(header, where);
            return { propName: toSwiftPropertyName(header.name), type: header.optional ? `${type}?` : type };
        });
        lines.push('');
        lines.push(...docLines(`Response headers declared on ${where}.`, ''));
        lines.push(`public struct ${name}: Equatable, Sendable {`);
        for (const f of fields) lines.push(`    public let ${f.propName}: ${f.type}`);
        lines.push('');
        lines.push(`    public init(${fields.map(f => `${f.propName}: ${f.type}`).join(', ')}) {`);
        for (const f of fields) lines.push(`        self.${f.propName} = ${f.propName}`);
        lines.push('    }');
        lines.push('}');
    };

    if (shape.kind === 'simple') {
        const response = shape.response;
        const headers = response?.headers ?? [];
        if (headers.length === 0) return lines;
        headerStruct(headers, headersStructName(op, base));
        const body = response?.bodies[0];
        if (body) {
            const dataType = bodySwiftType(body, ctx);
            lines.push('');
            lines.push(...docLines(`The body of ${where}, with the response headers the contract declares.`, ''));
            lines.push(`public struct ${base}Result: Equatable, Sendable {`);
            lines.push(`    public let data: ${dataType}`);
            lines.push(`    public let headers: ${headersStructName(op, base)}`);
            lines.push('');
            lines.push(`    public init(data: ${dataType}, headers: ${headersStructName(op, base)}) {`);
            lines.push('        self.data = data');
            lines.push('        self.headers = headers');
            lines.push('    }');
            lines.push('}');
        }
        return lines;
    }

    const responses = observableOf(shape);
    const withStatus = shape.kind === 'multiStatus';
    for (const response of responses) {
        const headers = response.headers ?? [];
        if (headers.length > 0) headerStruct(headers, headersStructName(op, base, withStatus ? response.statusCode : undefined));
    }

    lines.push('');
    lines.push(
        ...docLines(
            `What ${where} returned.\n\n` +
                (withStatus
                    ? 'The operation declares several statuses the service produces, so the status is part of the value.'
                    : 'The status declares several content types, so which one arrived is part of the value.'),
            '',
        ),
    );
    lines.push(`public enum ${base}Response: Equatable, Sendable {`);
    for (const response of responses) {
        const statusCode = withStatus ? response.statusCode : undefined;
        const headers = response.headers ?? [];
        const headersType = headers.length > 0 ? headersStructName(op, base, statusCode) : undefined;
        const bodies = response.bodies.length > 0 ? response.bodies : [undefined];
        for (const body of bodies) {
            const name = leafCaseName(response, body, statusCode);
            const payload: string[] = [];
            if (body && headersType) payload.push(`data: ${bodySwiftType(body, ctx)}`, `headers: ${headersType}`);
            else if (body) payload.push(bodySwiftType(body, ctx));
            else if (headersType) payload.push(`headers: ${headersType}`);
            lines.push(payload.length > 0 ? `    case ${name}(${payload.join(', ')})` : `    case ${name}`);
        }
    }
    lines.push('}');
    return lines;
}

/**
 * The Swift type of a response header. The runtime parses the raw string through
 * `HeaderDecodable`, so the type is all the generator has to decide.
 *
 * Header values arrive as text, so the declared type is what the caller gets and the conversion
 * happens in the runtime. The accepted set mirrors the TypeScript, Python, and Kotlin SDKs;
 * anything else is rejected at build time rather than silently handed back as a string.
 *
 * @throws {Error} When the header's declared type cannot be read from an HTTP header.
 */
function headerSwiftType(header: OpResponseHeaderNode, where: string): string {
    const scalar = header.type.kind === 'scalar' ? header.type.name : undefined;
    switch (scalar) {
        case 'string':
        case 'email':
        case 'url':
        case 'interval':
        case 'unknown':
            return 'String';
        case 'number':
            return 'Double';
        case 'int':
            return 'Int';
        case 'bigint':
            return 'BigIntValue';
        case 'boolean':
            return 'Bool';
        case 'uuid':
            return 'UUID';
        case 'date':
            return 'LocalDate';
        case 'time':
            return 'LocalTime';
        case 'datetime':
            return 'Date';
        case 'duration':
            return 'IsoDuration';
        default:
            throw new Error(
                `plugin-swift: response header '${header.name}' on ${where} is declared as ${describeHeaderType(header.type)}, ` +
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
function readHeaderLines(headers: OpResponseHeaderNode[], typeName: string, where: string, indent: string): string[] {
    const lines: string[] = [`${indent}let headers = try ${typeName}(`];
    headers.forEach((header, i) => {
        const type = headerSwiftType(header, where);
        const name = quoteSwiftString(header.name);
        // A required header the service omitted is a broken contract, not a nil the caller has to
        // handle; an optional one simply stays absent.
        const reader = header.optional ? 'optionalHeader' : 'requireHeader';
        const comma = i < headers.length - 1 ? ',' : '';
        lines.push(`${indent}    ${toSwiftPropertyName(header.name)}: http.${reader}(response, ${name}, as: ${type}.self)${comma}`);
    });
    lines.push(`${indent})`);
    return lines;
}

function methodDoc(route: OpRouteNode, op: OpOperationNode, observable: OpResponseNode[]): string[] {
    const parts: string[] = [];
    if (op.name) parts.push(op.name);
    const description = op.description ?? route.description;
    if (description) parts.push(description);

    const thrown = op.responses.filter(r => !observable.includes(r)).map(r => r.statusCode);
    if (thrown.length > 0) parts.push(`- Throws: \`SdkError\` on ${thrown.join(', ')}`);
    if (parts.length === 0) return [];
    return docLines(parts.join('\n'), '');
}

// ─── Path building ─────────────────────────────────────────────────────────

/**
 * Placeholder names as the `.ck` grammar allows them: `-` and `.` are legal inside one, so a
 * narrower pattern would leave `{payment-id}` in the path and send the braces to the server.
 */
const PATH_PLACEHOLDER = /\{([a-zA-Z_$][a-zA-Z0-9_$.-]*)\}/g;

/**
 * Render a route path as the array of segment expressions that builds the URL.
 *
 * Literal segments stay string literals and dynamic ones go through `http.segment(...)`, so the
 * runtime percent-encodes exactly the values that came from the caller. `params` says where a
 * value lives: spread across the signature, or behind one `params` argument when the route
 * declares a model.
 */
export function buildPathSegments(
    path: string,
    params?: ParamSource,
    bindings?: ReadonlyMap<string, string>,
): { segments: string[]; throws: boolean } {
    let throws = false;
    const segments = path
        .split('/')
        .filter(Boolean)
        .map(raw => {
            PATH_PLACEHOLDER.lastIndex = 0;
            const match = PATH_PLACEHOLDER.exec(raw);
            if (!match || match[0] !== raw) return quoteSwiftString(raw);
            throws = true;
            if (params && params.kind !== 'params') return `http.segment(params.${toSwiftPropertyName(match[1]!)})`;
            return `http.segment(${bindings?.get(match[1]!) ?? toSwiftPropertyName(match[1]!)})`;
        });
    return { segments, throws };
}

// ─── Parameters ────────────────────────────────────────────────────────────

/**
 * Identifiers a generated method binds or reads besides its path parameters: the other arguments
 * {@link buildMethodParams} can declare, the locals the body declares, and the client's own `http`
 * property, which the body reads without `self.`. A path parameter under one of these names would
 * repeat an argument label, collide with a local, or hide `http`.
 */
const METHOD_LOCALS = ['body', 'query', 'customHeaders', 'params', 'request', 'response', 'headers', 'http'] as const;

/**
 * The Swift parameter name each inline path parameter is spread into the signature under, keyed by
 * its declared name. Backtick-escaped (`` `class` ``), and suffixed when it lands on one of
 * {@link METHOD_LOCALS} (`body_`). Empty when the route has no inline params.
 */
function bindPathParams(route: OpRouteNode): Map<string, string> {
    if (route.params?.kind !== 'params') return new Map();
    return bindSwiftParameterNames(
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
 * The method signature, in the order a caller reads it: path, body, query, headers.
 *
 * Swift, unlike Python, allows a required parameter after a defaulted one, so nothing has to be
 * widened or reordered to keep the declaration legal.
 */
function buildMethodParams(route: OpRouteNode, op: OpOperationNode, ctx: RenderContext, pathBindings: ReadonlyMap<string, string>): MethodParam[] {
    const params: MethodParam[] = [];

    if (route.params) {
        if (route.params.kind === 'params') {
            for (const node of route.params.nodes) {
                params.push({ name: pathBindings.get(node.name)!, type: renderSwiftType(node.type, ctx, true), optional: false });
            }
        } else {
            params.push({ name: 'params', type: renderParamSourceType(route.params, ctx, ''), optional: false });
        }
    }

    const body = op.request?.bodies[0];
    if (body) {
        switch (classifyContentType(body.contentType)) {
            case 'multipart':
                // The runtime assembles a multipart body from parts the caller builds; the declared
                // contract type describes the fields, not a value the client can send as one.
                params.push({ name: 'body', type: '[MultipartPart]', optional: false });
                break;
            case 'binary':
                params.push({ name: 'body', type: 'Data', optional: false });
                break;
            case 'text':
                params.push({ name: 'body', type: 'String', optional: false });
                break;
            default:
                params.push({ name: 'body', type: renderSwiftType(body.bodyType, ctx, true), optional: false });
        }
    }

    const base = toSwiftTypeName(deriveMethodName(op, route).replace(/`/g, ''));
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
    if (source.kind === 'ref') return renderSwiftType({ kind: 'ref', name: source.name }, ctx, true);
    if (source.kind === 'type') return renderSwiftType(source.node, ctx, true);
    // The struct emitted for this method, or a plain dictionary when the block declares nothing.
    return source.nodes.length > 0 ? generatedName : '[String: String]';
}

// ─── Method naming ─────────────────────────────────────────────────────────

/**
 * The SDK method name, in the same priority order every ContractKit SDK uses: an explicit `sdk:`,
 * then the operation's `name:`, then a name inferred from the verb and path. Only the case
 * convention differs between the SDKs.
 */
export function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return escapeSwiftIdentifier(toSwiftMethodName(op.sdk));
    if (op.name) return escapeSwiftIdentifier(toSwiftMethodName(op.name));
    return escapeSwiftIdentifier(inferMethodName(op.method, route.path));
}

function inferMethodName(method: string, path: string): string {
    const parts = [method.toLowerCase()];
    for (const segment of path.split('/').filter(Boolean)) {
        if (segment.startsWith('{')) parts.push(`By${toSwiftTypeName(segment.slice(1, -1))}`);
        else parts.push(toSwiftTypeName(segment));
    }
    return parts.join('');
}

/** camelCase a human-written name: `"Create an Offer"` becomes `createAnOffer`. */
function toSwiftMethodName(name: string): string {
    const pascal = toSwiftTypeName(name);
    return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
