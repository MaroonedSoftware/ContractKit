import type {
    OpRootNode,
    OpRouteNode,
    OpOperationNode,
    OpResponseNode,
    OpResponseHeaderNode,
    ContractTypeNode,
    ScalarTypeNode,
    ParamSource,
    ObjectMode,
} from '@contractkit/core';
import { resolveModifiers, resolveSecurity, SECURITY_NONE, classifyContentType, emittedResponses } from '@contractkit/core';
import {
    renderType,
    renderInputType,
    renderQueryType,
    pascalToDotCase,
    modeToWrapper,
} from './codegen-contract.js';
import { renderOutputTsType, quoteKey, headerNameToProperty, escapeJsDocLines, escapeSingleQuoted, sourceLink } from './ts-render.js';
import { DECIMAL_IMPORT, DECIMAL_PRELUDE_LINES } from './decimal-runtime.js';
import { basename, dirname, relative } from 'path';

// ─── Content-type helpers ──────────────────────────────────────────────────

/** Map a request MIME type to the koa-bodyparser parser token used in middleware. */
function bodyParserToken(contentType: string): string {
    switch (classifyContentType(contentType)) {
        case 'urlencoded':
            return 'urlencoded';
        case 'multipart':
            return 'multipart';
        case 'text':
            return 'text';
        case 'binary':
            // koa-bodyparser has no native binary token; fall back to text so the body is
            // still readable as a string. Services handling binary uploads should switch to
            // multipart/form-data.
            return 'text';
        default:
            return 'json';
    }
}

/**
 * Deep structural equality on ContractTypeNode, ignoring source locations on inline fields.
 * Used to decide whether multiple declared request MIMEs can share a single validate path.
 */
export function bodyTypesStructurallyEqual(a: ContractTypeNode, b: ContractTypeNode): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'scalar': {
            const bb = b as typeof a;
            return (
                a.name === bb.name &&
                a.min === bb.min &&
                a.max === bb.max &&
                a.len === bb.len &&
                a.scale === bb.scale &&
                a.regex === bb.regex &&
                a.format === bb.format
            );
        }
        case 'array': {
            const bb = b as typeof a;
            return a.min === bb.min && a.max === bb.max && bodyTypesStructurallyEqual(a.item, bb.item);
        }
        case 'tuple': {
            const bb = b as typeof a;
            return a.items.length === bb.items.length && a.items.every((x, i) => bodyTypesStructurallyEqual(x, bb.items[i]!));
        }
        case 'record': {
            const bb = b as typeof a;
            return bodyTypesStructurallyEqual(a.key, bb.key) && bodyTypesStructurallyEqual(a.value, bb.value);
        }
        case 'enum': {
            const bb = b as typeof a;
            return a.values.length === bb.values.length && a.values.every((v, i) => v === bb.values[i]);
        }
        case 'literal': {
            const bb = b as typeof a;
            return a.value === bb.value;
        }
        case 'union':
        case 'intersection': {
            const bb = b as typeof a;
            return a.members.length === bb.members.length && a.members.every((m, i) => bodyTypesStructurallyEqual(m, bb.members[i]!));
        }
        case 'discriminatedUnion': {
            const bb = b as typeof a;
            return (
                a.discriminator === bb.discriminator &&
                a.members.length === bb.members.length &&
                a.members.every((m, i) => bodyTypesStructurallyEqual(m, bb.members[i]!))
            );
        }
        case 'ref': {
            const bb = b as typeof a;
            return a.name === bb.name && !!a.lazy === !!bb.lazy;
        }
        case 'lazy': {
            const bb = b as typeof a;
            return bodyTypesStructurallyEqual(a.inner, bb.inner);
        }
        case 'inlineObject': {
            const bb = b as typeof a;
            if (a.mode !== bb.mode) return false;
            if (a.fields.length !== bb.fields.length) return false;
            return a.fields.every((f, i) => {
                const g = bb.fields[i]!;
                return (
                    f.name === g.name &&
                    f.optional === g.optional &&
                    f.nullable === g.nullable &&
                    f.visibility === g.visibility &&
                    f.default === g.default &&
                    !!f.deprecated === !!g.deprecated &&
                    bodyTypesStructurallyEqual(f.type, g.type)
                );
            });
        }
    }
}

// ─── Public entry point ────────────────────────────────────────────────────

/** Options controlling how {@link generateOp} renders a Koa router module. */
export interface OpCodegenOptions {
    servicePathTemplate?: string;
    typeImportPathTemplate?: string;
    outPath?: string;
    /** Map from model name → absolute output file path (for cross-module type imports) */
    modelOutPaths?: Map<string, string>;
    /** Set of model names that have Input variants (models with visibility modifiers) */
    modelsWithInput?: Set<string>;
    /** Set of model names that have Output variants (models with format(output=...)) */
    modelsWithOutput?: Set<string>;
    /**
     * Whether to emit handlers for operations marked `internal`. Defaults to `true` because
     * the server still needs routes for internal endpoints; set to `false` to omit them
     * from the generated router entirely.
     */
    includeInternal?: boolean;
    /**
     * Re-parse the service result through its declared response schema before writing `ctx.body`,
     * and write the parsed value. Requires the type file to hold Zod schemas (`server.zod`) —
     * plain interfaces are types, with no runtime schema value to validate against. Default false.
     */
    validateResponses?: boolean;
    /**
     * Set of model names whose schema applies a `format(...)` key transform, directly or through a
     * referenced model. Response bodies touching one are left unvalidated: the service returns the
     * post-transform shape, which the schema itself cannot re-parse.
     */
    modelsWithTransform?: Set<string>;
}

/**
 * Generate a Koa router module for every operation in `root`, including the imports, type
 * aliases, and handler list.
 *
 * Imports are derived from the generated body — each candidate symbol is emitted only if it
 * actually appears in the output. Deciding them from predicates over the AST instead means any
 * drift between predicate and codegen leaves an unused import in every generated file, which
 * trips `noUnusedLocals` and lint downstream.
 */
export function generateOp(root: OpRootNode, options: OpCodegenOptions = {}): string {
    // Collect all referenced types across all routes
    const types = collectTypes(root, options.modelsWithInput, options.modelsWithOutput);
    const services = collectServices(root);
    const routerName = deriveRouterName(root.file);

    const lines: string[] = [];

    lines.push('');
    lines.push('/**');
    lines.push(` * generated from ${sourceLink(basename(root.file), options.outPath, root.file)}`);
    lines.push('*/');
    lines.push(`export const ${routerName} = ServerKitRouter();`);
    lines.push('');

    const includeInternal = options.includeInternal ?? true;
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            lines.push(...generateHandler(route, op, root, options));
            lines.push('');
        }
    }

    // Helpers and imports are both decided from the code we just generated, not from predicates
    // over the AST that have to be kept in step with it by hand. A predicate that drifts leaves an
    // unused declaration in every generated file, which trips `noUnusedLocals` and lint in
    // consuming projects — `opNeedsScalar(root, 'binary')` over-approximates exactly that way,
    // since a binary *response* body is a plain `Buffer` annotation with no schema behind it.
    const handlerBody = lines.join('\n');
    const references = (symbol: string) => new RegExp(`\\b${symbol}\\b`).test(handlerBody);

    const helpers: string[] = [];
    if (references('_ZodBinary')) {
        helpers.push(`const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });`);
    }
    if (references('_ZodDatetime')) {
        helpers.push(
            `const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));`,
        );
    }
    if (references('_ZodDecimal')) {
        helpers.push(...DECIMAL_PRELUDE_LINES);
    }
    if (references('_ZodInterval')) {
        helpers.push(
            `const _ZodInterval = z.preprocess((val) => typeof val === 'string' ? Interval.fromISO(val) : val, z.custom<Interval>((val) => val instanceof Interval && val.isValid, { message: 'Must be an ISO 8601 interval' })).transform(val => val.toISO()!);`,
        );
    }
    // `_ZodJson`'s own declaration is annotated with `_JsonValue`, so the type alias comes along
    // with it; the alias is also needed on its own for a `json` body's server-side annotation.
    const needsZodJson = references('_ZodJson');
    if (needsZodJson || references('_JsonValue')) {
        helpers.push(`type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };`);
    }
    if (needsZodJson) {
        helpers.push(
            `const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));`,
        );
    }

    const generated = [...(helpers.length ? ['', ...helpers] : []), ...lines].join('\n');
    const uses = (symbol: string) => new RegExp(`\\b${symbol}\\b`).test(generated);

    const body: string[] = [];

    const koaImports = ['ServerKitRouter', 'bodyParserMiddleware', 'requirePolicy', 'requireSignature'].filter(uses);
    if (koaImports.length > 0) {
        body.push(`import { ${koaImports.join(', ')} } from '@maroonedsoftware/koa';`);
    }

    // Services and model names come from the AST, which over-approximates two ways: a model with an
    // Input/Output variant contributes its base name even when only the variant is ever annotated,
    // and `collectServices`/`collectTypes` walk every operation including the `internal` ones
    // `includeInternal: false` drops. Filtering through `uses` — the same gate every symbol above
    // goes through — keeps the import list to what the handlers actually reference, so generated
    // code does not trip `noUnusedLocals` in the consuming project.
    for (const svc of services.filter(uses)) {
        const modulePath = root.services?.[svc] ?? root.meta[svc] ?? deriveModulePath(svc, options.servicePathTemplate);
        body.push(`import { ${svc} } from '${modulePath}';`);
    }

    const usedTypes = types.filter(uses);
    if (usedTypes.length > 0) {
        body.push(...generateTypeImports(usedTypes, root.file, options));
    }

    // luxon is needed for date/time/datetime (DateTime), duration (Duration) and interval (Interval);
    // the rendered Zod schemas and the service-result annotations both reference these classes.
    const luxonImports = ['DateTime', 'Duration', 'Interval'].filter(uses);
    if (luxonImports.length > 0) {
        body.push(`import { ${luxonImports.join(', ')} } from 'luxon';`);
    }

    // Same `uses` gate: `Decimal` appears in the `_ZodDecimal` helper and in service-result
    // annotations via `serverTsScalar`, and the helper text is folded into `generated` above.
    if (uses('Decimal')) {
        body.push(DECIMAL_IMPORT);
    }

    if (uses('parseAndValidate')) {
        body.push(`import { parseAndValidate } from '@maroonedsoftware/zod';`);
    }

    if (uses('MultipartBody')) {
        body.push(`import { MultipartBody } from '@maroonedsoftware/multipart';`);
    }

    const allContent = [...body, ...(helpers.length ? ['', ...helpers] : []), ...lines].join('\n');
    const needsZod = /\bz\./.test(allContent);
    return (needsZod ? `import { z } from 'zod';\n` : '') + allContent;
}

// ─── Handler generation ────────────────────────────────────────────────────

function generateHandler(route: OpRouteNode, op: OpOperationNode, root: OpRootNode, options: OpCodegenOptions): string[] {
    const lines: string[] = [];
    const file = root.file;
    const outPath = options.outPath;
    const modelsWithInput = options.modelsWithInput;

    lines.push('/**');

    // JSDoc from description
    const desc = op.description ?? route.description;
    if (desc) {
        for (const l of escapeJsDocLines(desc)) lines.push(` * ${l}`);
    }
    // Source location comment
    lines.push(` * from ${sourceLink(basename(file), outPath, file, op.loc.line)}`);

    // Security annotation (operation-level wins; falls back to route → file level)
    const effectiveSecurity = resolveSecurity(route, op, root);
    if (effectiveSecurity === SECURITY_NONE) {
        lines.push(` * anonymous access, no security required`);
    }

    // Modifier annotations
    const mods = resolveModifiers(route, op);
    if (mods.includes('internal')) lines.push(` * @internal`);
    if (mods.includes('deprecated')) lines.push(` * @deprecated`);

    lines.push('*/');

    const method = op.method;
    const path = route.path.replace(/\{(\w+)\}/g, ':$1');
    const bodies = op.request?.bodies ?? [];
    const hasBody = bodies.length > 0;
    const isSingleMultipart = bodies.length === 1 && bodies[0]!.contentType === 'multipart/form-data';

    // Middleware list
    const middlewares: string[] = [];
    if (effectiveSecurity !== SECURITY_NONE) {
        const policy = effectiveSecurity?.policy;
        const args =
            policy === undefined
                ? ''
                : policy === false
                  ? '{ policy: false }'
                  : `{ policy: '${policy}' }`;
        middlewares.push(`requirePolicy(${args})`);
    }
    if (hasBody) {
        const parserTokens = Array.from(new Set(bodies.map(b => bodyParserToken(b.contentType))));
        const tokensExpr = parserTokens.map(t => `'${t}'`).join(', ');
        middlewares.push(`bodyParserMiddleware([${tokensExpr}])`);
    }
    if (op.signature) {
        const sigArgs = op.signaturePolicy
            ? `'${escapeSingleQuoted(op.signature)}', { policy: '${escapeSingleQuoted(op.signaturePolicy)}' }`
            : `'${escapeSingleQuoted(op.signature)}'`;
        middlewares.push(`requireSignature(${sigArgs})`);
    }
    const middlewareStr = middlewares.length > 0 ? `, ${middlewares.join(', ')},` : ',';

    lines.push(`${deriveRouterName(file)}.${method}('${path}'${middlewareStr} async ctx => {`);

    // Params / query / headers validation (request-side — use Input variants)
    lines.push(...generateParamValidation(route.params, 'ctx.params', 'params', route.paramsMode ?? 'strict', '', modelsWithInput));
    lines.push(...generateParamValidation(op.query, 'ctx.query', 'query', op.queryMode ?? 'strict', '', modelsWithInput));
    lines.push(...generateParamValidation(op.headers, 'ctx.headers', 'headers', op.headersMode ?? 'strip', '', modelsWithInput));

    // Body validation (request-side — use Input variants)
    if (hasBody && op.request) {
        if (isSingleMultipart) {
            lines.push(`    const multipartBody = ctx.parsedBody as MultipartBody;`);
            lines.push('');
        } else if (bodies.length === 1) {
            lines.push(`    const body = await parseAndValidate(ctx.parsedBody, ${renderInputType(bodies[0]!.bodyType, modelsWithInput)});`);
            lines.push('');
        } else if (bodies.every(b => bodyTypesStructurallyEqual(b.bodyType, bodies[0]!.bodyType))) {
            // All declared MIMEs share the same body shape — single validation suffices
            lines.push(`    const body = await parseAndValidate(ctx.parsedBody, ${renderInputType(bodies[0]!.bodyType, modelsWithInput)});`);
            lines.push('');
        } else {
            // Different body types per MIME — dispatch on Content-Type
            const annotation = bodies
                .map(b =>
                    b.contentType === 'multipart/form-data' ? 'MultipartBody' : `z.infer<typeof ${renderInputType(b.bodyType, modelsWithInput)}>`,
                )
                .join(' | ');
            lines.push(`    let body!: ${annotation};`);
            lines.push(`    switch (ctx.request.type) {`);
            for (const b of bodies) {
                lines.push(`        case '${b.contentType}':`);
                if (b.contentType === 'multipart/form-data') {
                    lines.push(`            body = ctx.parsedBody as MultipartBody;`);
                } else {
                    lines.push(`            body = await parseAndValidate(ctx.parsedBody, ${renderInputType(b.bodyType, modelsWithInput)});`);
                }
                lines.push(`            break;`);
            }
            lines.push(`    }`);
            lines.push('');
        }
    }

    // Service call. `emittedResponses` decides which of the declared statuses the service is
    // responsible for producing; the rest are documentation, or the thrown-error path.
    const emitted = emittedResponses(op);
    const serviceParts = inferService(op, route, file);
    const call = `await service.${serviceParts.methodName}(${buildArgs(route, op)})`;

    if (emitted.length > 1) {
        lines.push(...generateMultiStatusResult(emitted, serviceParts.className, call, options));
    } else {
        lines.push(...generateSingleStatusResult(emitted[0], op, serviceParts.className, call, options));
    }

    lines.push(`});`);

    return lines;
}

/**
 * The service produces exactly one status (or none): the result is the body itself, or
 * `{ body, headers }` when the status declares headers, and `ctx.status` is a constant.
 *
 * A status declaring several mimes also gains a `contentType` the service picks, which is the
 * only thing here that can turn `ctx.type` from a literal into an expression.
 */
function generateSingleStatusResult(
    resp: OpResponseNode | undefined,
    op: OpOperationNode,
    className: string,
    call: string,
    options: OpCodegenOptions,
): string[] {
    const lines: string[] = [];
    const bodies = resp ? resp.bodies : [];
    const respHeaders = resp?.headers ?? [];
    const hasRespHeaders = respHeaders.length > 0;
    const headersAnnotation = hasRespHeaders ? renderHeadersAnnotation(respHeaders, options.modelsWithOutput) : '';

    let bodySchema: string | undefined;

    if (bodies.length === 1) {
        const { annotation, prelude } = formatTypeAnnotation(bodies[0]!.bodyType, options.modelsWithOutput);
        if (prelude) lines.push(`    ${prelude}`);
        bodySchema = responseBodySchema(bodies[0]!.bodyType, options, prelude ? 'resultType' : undefined);
        lines.push(`    const service = ctx.container.get(${className});`);
        if (hasRespHeaders) {
            lines.push(`    const result: { body: ${annotation}; headers: ${headersAnnotation} } = ${call};`);
        } else {
            lines.push(`    const result: ${annotation} = ${call};`);
        }
    } else if (bodies.length > 1) {
        const rendered = renderResponseMembers(resp!, options, { includeStatus: false, varPrefix: 'result' });
        const { members, preludes } = rendered;
        bodySchema = rendered.bodySchema;
        for (const prelude of preludes) lines.push(`    ${prelude}`);
        lines.push(`    const service = ctx.container.get(${className});`);
        lines.push(`    const result: ${members.join(' | ')} = ${call};`);
    } else {
        lines.push(`    const service = ctx.container.get(${className});`);
        if (hasRespHeaders) {
            lines.push(`    const result: { headers: ${headersAnnotation} } = ${call};`);
        } else {
            lines.push(`    ${call};`);
        }
    }

    lines.push('');
    // With nothing emitted, the status is still declared somewhere — fall back to the first
    // one written, which is what a documentation-only 3xx/4xx operation means.
    lines.push(`    ctx.status = ${resp?.statusCode ?? op.responses[0]?.statusCode ?? 200};`);
    lines.push(...headerSetLines(respHeaders, '    '));

    if (bodies.length === 1) {
        lines.push(`    ctx.type = '${bodies[0]!.contentType}';`);
        lines.push(`    ctx.body = ${responseBodyExpr(hasRespHeaders ? 'result.body' : 'result', bodySchema)};`);
    } else if (bodies.length > 1) {
        lines.push(`    ctx.type = result.contentType;`);
        lines.push(`    ctx.body = ${responseBodyExpr('result.body', bodySchema)};`);
    }

    return lines;
}

/**
 * The service chooses between several statuses: the result is a union discriminated on
 * `status`, and the handler switches on it so each status writes only its own headers, mime
 * and body.
 */
function generateMultiStatusResult(emitted: OpResponseNode[], className: string, call: string, options: OpCodegenOptions): string[] {
    const lines: string[] = [];
    const members: string[] = [];
    const preludes: string[] = [];

    const bodySchemas = new Map<number, string | undefined>();

    for (const resp of emitted) {
        const rendered = renderResponseMembers(resp, options, { includeStatus: true, varPrefix: `result${resp.statusCode}` });
        members.push(...rendered.members);
        preludes.push(...rendered.preludes);
        bodySchemas.set(resp.statusCode, rendered.bodySchema);
    }

    for (const prelude of preludes) lines.push(`    ${prelude}`);
    lines.push(`    const service = ctx.container.get(${className});`);
    lines.push(`    const result:`);
    for (const member of members) lines.push(`        | ${member}`);
    lines.push(`        = ${call};`);
    lines.push('');
    lines.push(`    ctx.status = result.status;`);
    lines.push(`    switch (result.status) {`);
    for (const resp of emitted) {
        lines.push(`        case ${resp.statusCode}:`);
        lines.push(...headerSetLines(resp.headers ?? [], '            '));
        if (resp.bodies.length > 0) {
            lines.push(`            ctx.type = result.contentType;`);
            lines.push(`            ctx.body = ${responseBodyExpr('result.body', bodySchemas.get(resp.statusCode))};`);
        }
        lines.push(`            break;`);
    }
    lines.push(`    }`);

    return lines;
}

/**
 * Render one status as the members of the service-result union — its `contentType`, `body` and
 * `headers`, plus `status` when the operation emits more than one.
 *
 * A status declaring several mimes collapses to a single member with a union of mime literals
 * when the bodies are structurally identical (`image/png` and `image/jpeg` both `binary`).
 * When they differ, it produces one member per mime so `contentType` and `body` stay correlated.
 */
function renderResponseMembers(
    resp: OpResponseNode,
    options: OpCodegenOptions,
    opts: { includeStatus: boolean; varPrefix: string },
): { members: string[]; preludes: string[]; bodySchema?: string } {
    const bodies = resp.bodies;
    const headers = resp.headers ?? [];
    const leading = opts.includeStatus ? [`status: ${resp.statusCode}`] : [];
    const trailing = headers.length > 0 ? [`headers: ${renderHeadersAnnotation(headers, options.modelsWithOutput)}`] : [];
    const preludes: string[] = [];

    if (bodies.length === 0) {
        return { members: [`{ ${[...leading, ...trailing].join('; ')} }`], preludes };
    }

    const uniform = bodies.every(b => bodyTypesStructurallyEqual(b.bodyType, bodies[0]!.bodyType));
    if (uniform) {
        const { annotation, prelude } = formatTypeAnnotation(bodies[0]!.bodyType, options.modelsWithOutput, `${opts.varPrefix}Type`);
        if (prelude) preludes.push(prelude);
        const bodySchema = responseBodySchema(bodies[0]!.bodyType, options, prelude ? `${opts.varPrefix}Type` : undefined);
        const contentType = bodies.map(b => `'${b.contentType}'`).join(' | ');
        return {
            members: [`{ ${[...leading, `contentType: ${contentType}`, `body: ${annotation}`, ...trailing].join('; ')} }`],
            preludes,
            bodySchema,
        };
    }

    // One member per mime: `contentType` and `body` stay correlated, so validating would need a
    // second switch on `result.contentType` nested inside the status switch. Left unvalidated —
    // note the absent `bodySchema` in the return below.
    const members = bodies.map((b, i) => {
        const { annotation, prelude } = formatTypeAnnotation(b.bodyType, options.modelsWithOutput, `${opts.varPrefix}Type${i}`);
        if (prelude) preludes.push(prelude);
        return `{ ${[...leading, `contentType: '${b.contentType}'`, `body: ${annotation}`, ...trailing].join('; ')} }`;
    });
    return { members, preludes };
}

function renderHeadersAnnotation(headers: OpResponseHeaderNode[], modelsWithOutput?: Set<string>): string {
    const fields = headers.map(
        h => `${quoteKey(headerNameToProperty(h.name))}${h.optional ? '?' : ''}: ${renderOutputTsType(h.type, modelsWithOutput, 'server')}`,
    );
    return `{ ${fields.join('; ')} }`;
}

/** `ctx.set(...)` calls for a status's declared response headers, guarding the optional ones. */
function headerSetLines(headers: OpResponseHeaderNode[], indent: string): string[] {
    return headers.map(h => {
        const accessor = `result.headers[${JSON.stringify(headerNameToProperty(h.name))}]`;
        return h.optional
            ? `${indent}if (${accessor} !== undefined) ctx.set('${h.name}', String(${accessor}));`
            : `${indent}ctx.set('${h.name}', String(${accessor}));`;
    });
}

// ─── Inference helpers ─────────────────────────────────────────────────────

/**
 * Resolve the service class and method a handler should delegate to.
 *
 * Uses the operation's explicit `service: Class.method` declaration when present; otherwise derives
 * the class from the contract file name (`ledger.categories.ck` → `LedgerCategoriesService`) and the
 * method from the HTTP verb and whether the path carries a parameter (`get` → `list` / `getById`).
 *
 * @param file Path of the `.ck` file the operation came from.
 */
export function inferService(op: OpOperationNode, route: OpRouteNode, file: string): { className: string; methodName: string } {
    // If explicitly declared: service: ServiceClass.methodName
    if (op.service) {
        const [cls = '', method] = op.service.split('.');
        return { className: cls, methodName: method ?? 'handle' };
    }

    // Infer from file name + method + path
    const baseName = deriveBaseName(file); // e.g. "ledger.categories" -> "LedgerCategories"
    const className = `${baseName}Service`;
    const methodName = inferMethodName(op.method, route.path);
    return { className, methodName };
}

function inferMethodName(method: string, path: string): string {
    const hasParam = path.includes('{');
    switch (method) {
        case 'get':
            return hasParam ? 'getById' : 'list';
        case 'post':
            return 'create';
        case 'put':
            return 'replace';
        case 'patch':
            return 'update';
        case 'delete':
            return 'delete';
        default:
            return 'handle';
    }
}

/**
 * Build the comma-separated argument list passed to the service method in a generated handler.
 *
 * Order is params, body, query, headers. Inline path params are spread as individual identifiers;
 * a referenced/compound params type is passed as a single `params` object. A lone
 * `multipart/form-data` request body is passed as `multipartBody` rather than `body`.
 *
 * @returns The rendered argument list, or an empty string when the method takes no arguments.
 */
export function buildArgs(route: OpRouteNode, op: OpOperationNode): string {
    const args: string[] = [];
    // Path params: spread individually (inline) or pass 'params' object (type-ref/ContractTypeNode)
    if (route.params) {
        if (route.params.kind === 'params') {
            args.push(...route.params.nodes.map(p => p.name));
        } else {
            args.push('params');
        }
    }
    // Body
    if (op.request && op.request.bodies.length > 0) {
        const bodies = op.request.bodies;
        const isSingleMultipart = bodies.length === 1 && bodies[0]!.contentType === 'multipart/form-data';
        args.push(isSingleMultipart ? 'multipartBody' : 'body');
    }
    // Query
    if (op.query) args.push('query');
    // Headers
    if (op.headers) args.push('headers');
    return args.join(', ');
}

/**
 * Map a `.ck` scalar to the TypeScript type a server handler sees, i.e. `z.infer` of the schema
 * `renderType` emits for that scalar. This is deliberately NOT `renderTsScalar` from ts-render:
 * that one describes the wire/SDK view (`binary` → `Blob`, dates → `string`), while the router
 * runs on Node against the parsed Zod output (`binary` → `Buffer`, dates → luxon `DateTime`).
 */
function serverTsScalar(name: ScalarTypeNode['name']): string {
    switch (name) {
        case 'string':
        case 'email':
        case 'url':
        case 'uuid':
            return 'string';
        case 'number':
        case 'int':
            return 'number';
        case 'bigint':
            return 'bigint';
        case 'decimal':
            // Unlike the date scalars, this matches `renderTsScalar`'s wire view — `_ZodDecimal`
            // has no output transform, so `z.infer` is a `Decimal` on both sides.
            return 'Decimal';
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'time':
        case 'datetime':
            return 'DateTime';
        case 'duration':
            return 'Duration';
        case 'interval':
            // _ZodInterval transforms to an ISO string, so the inferred output type is string.
            return 'string';
        case 'binary':
            return 'Buffer';
        case 'json':
            return '_JsonValue';
        case 'object':
            return 'Record<string, unknown>';
        case 'null':
            return 'null';
        case 'unknown':
            return 'unknown';
        default: {
            const _exhaustive: never = name;
            throw new Error(`plugin-typescript: unmapped scalar '${String(_exhaustive)}' — add a case`);
        }
    }
}

/**
 * @param varName Name for the extracted schema variable. Distinct per status and per mime when
 *   an operation emits several, so two complex bodies in one handler cannot collide.
 */
function formatTypeAnnotation(bodyType: ContractTypeNode, modelsWithOutput?: Set<string>, varName = 'resultType'): { annotation: string; prelude?: string } {
    if (bodyType.kind === 'array') {
        const inner = formatTypeAnnotation(bodyType.item, modelsWithOutput, varName);
        return { annotation: `${inner.annotation}[]`, prelude: inner.prelude };
    }
    if (bodyType.kind === 'ref') {
        const name = modelsWithOutput?.has(bodyType.name) ? `${bodyType.name}Output` : bodyType.name;
        return { annotation: name };
    }
    if (bodyType.kind === 'scalar') return { annotation: serverTsScalar(bodyType.name) };
    // For complex types, extract schema into a variable so the result line stays readable
    const schema = renderType(bodyType);
    return {
        annotation: `z.infer<typeof ${varName}>`,
        prelude: `const ${varName} = ${schema};`,
    };
}

/**
 * Whether a response body can be soundly re-parsed through the schema `renderType` emits for it.
 *
 * False for anything transitively touching a model with a `format(...)` key transform — the service
 * returns the post-transform value while the schema expects the pre-transform one — and for an
 * intersection outside `renderIntersection`'s `.extend()` fast path, where `.and()` of two strict
 * objects rejects every value because each side sees the other's keys as unrecognized.
 */
function isRevalidatable(type: ContractTypeNode, modelsWithOutput?: Set<string>, modelsWithTransform?: Set<string>): boolean {
    const rec = (t: ContractTypeNode): boolean => isRevalidatable(t, modelsWithOutput, modelsWithTransform);
    switch (type.kind) {
        case 'ref':
            return !modelsWithOutput?.has(type.name) && !modelsWithTransform?.has(type.name);
        case 'array':
            return rec(type.item);
        case 'tuple':
            return type.items.every(rec);
        case 'record':
            return rec(type.key) && rec(type.value);
        case 'intersection': {
            // Mirrors renderIntersection: a lone member renders as itself, `ref & (ref|object)*`
            // renders as an `.extend()` chain, and anything else falls back to `.and()`.
            const [first, ...rest] = type.members;
            if (!first) return true;
            if (rest.length === 0) return rec(first);
            const usesExtendChain = first.kind === 'ref' && rest.every(m => m.kind === 'ref' || m.kind === 'inlineObject');
            return usesExtendChain && type.members.every(rec);
        }
        case 'union':
        case 'discriminatedUnion':
            return type.members.every(rec);
        case 'inlineObject':
            return type.fields.every(f => rec(f.type));
        case 'lazy':
            return rec(type.inner);
        default:
            // scalar, enum, literal — identity or idempotent under re-parse
            return true;
    }
}

/**
 * The runtime schema a handler validates a response body against, or `undefined` when the body
 * cannot be soundly re-parsed and validation must be skipped.
 *
 * @param preludeVar The schema const {@link formatTypeAnnotation} already emitted for this body
 *   (complex types only — `undefined` when it returned no prelude). Reusing it keeps a large object
 *   literal from appearing twice in the same handler.
 */
function responseBodySchema(bodyType: ContractTypeNode, options: OpCodegenOptions, preludeVar: string | undefined): string | undefined {
    if (!options.validateResponses) return undefined;
    if (!isRevalidatable(bodyType, options.modelsWithOutput, options.modelsWithTransform)) return undefined;
    return preludeVar ?? renderType(bodyType);
}

/**
 * The `ctx.body = ...` right-hand side for a response body: the raw result expression, or a
 * `parseAndValidate` of it. The `500` is deliberate — a service returning a shape its own contract
 * rejects is a server fault, not a client one, and `@maroonedsoftware/zod` routes the field-level
 * detail to `internalDetails` (log-only) rather than the response body at 5xx.
 */
function responseBodyExpr(value: string, schema: string | undefined): string {
    return schema ? `await parseAndValidate(${value}, ${schema}, 500)` : value;
}

function generateParamValidation(
    source: ParamSource | undefined,
    ctxExpr: string,
    varName: string,
    mode: ObjectMode,
    suffix = '',
    modelsWithInput?: Set<string>,
): string[] {
    if (!source) return [];
    const lines: string[] = [];
    const isQuery = ctxExpr === 'ctx.query';
    if (source.kind === 'ref') {
        // Type reference — apply mode as a method call on the schema
        const typeName = modelsWithInput?.has(source.name) ? `${source.name}Input` : source.name;
        lines.push(`    const ${varName} = await parseAndValidate(${ctxExpr}, ${typeName}.${mode}());`);
        lines.push('');
    } else if (source.kind === 'params') {
        // Inline param declarations — wrap with the appropriate z.*Object constructor
        if (source.nodes.length > 0) {
            // Destructure only for params (spread individually in service call);
            // query/headers are passed as whole objects.
            const lhs = varName === 'params' ? `{ ${source.nodes.map(p => p.name).join(', ')} }` : varName;
            lines.push(`    const ${lhs} = await parseAndValidate(`);
            lines.push(`        ${ctxExpr},`);
            lines.push(`        ${modeToWrapper(mode)}({`);
            for (const param of source.nodes) {
                const key = isValidIdentifier(param.name) ? param.name : `'${param.name}'`;
                if (isQuery && param.type.kind === 'array') {
                    const inner = renderType(param.type);
                    lines.push(`            ${key}: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, ${inner}),`);
                } else {
                    lines.push(`            ${key}: ${renderType(param.type)},`);
                }
            }
            lines.push(`        })${suffix},`);
            lines.push(`    );`);
            lines.push('');
        }
    } else {
        // ContractTypeNode — use query-aware rendering for query params (coerces single string → array),
        // otherwise use Input variant rendering; apply mode as a method call
        const schema = isQuery ? renderQueryType(source.node, modelsWithInput) : renderInputType(source.node, modelsWithInput);
        lines.push(`    const ${varName} = await parseAndValidate(${ctxExpr}, (${schema}).${mode}());`);
        lines.push('');
    }
    return lines;
}

// ─── Type import resolution ────────────────────────────────────────────────

/**
 * Generate per-file type import statements.
 * When modelOutPaths is available, groups types by their actual output file
 * and computes correct relative paths. Falls back to the template-based
 * single-import approach for types not found in the map.
 */
function generateTypeImports(types: string[], opFile: string, options: OpCodegenOptions): string[] {
    const lines: string[] = [];
    const { modelOutPaths, outPath } = options;

    if (modelOutPaths && outPath) {
        // Group types by their output file
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

        // Emit one import per source file with a relative path
        const fromDir = dirname(outPath);
        for (const [typeOutPath, names] of byFile) {
            let rel = relative(fromDir, typeOutPath);
            rel = rel.replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            lines.push(`import { ${names.sort().join(', ')} } from '${rel}';`);
        }

        // Fallback for types not in the map
        for (const type of unresolved) {
            const moduleName = pascalToDotCase(type);
            lines.push(`import { ${type} } from './${moduleName}.js';`);
        }
    } else {
        // No resolution context — fall back to template-based single import
        const typeImport = deriveTypeImportPath(opFile, options.typeImportPathTemplate);
        lines.push(`import { ${types.join(', ')} } from '${typeImport}';`);
    }

    return lines;
}

// ─── Collection helpers ────────────────────────────────────────────────────

function collectTypes(root: OpRootNode, modelsWithInput?: Set<string>, modelsWithOutput?: Set<string>): string[] {
    const types = new Set<string>();
    for (const route of root.routes) {
        collectParamSourceRefs(route.params, types);
        collectParamSourceInputRefs(route.params, types, modelsWithInput);
        for (const op of route.operations) {
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
        case 'tuple':
            type.items.forEach(t => collectOutputTypeNodeRefs(t, out, modelsWithOutput));
            break;
        case 'record':
            collectOutputTypeNodeRefs(type.key, out, modelsWithOutput);
            collectOutputTypeNodeRefs(type.value, out, modelsWithOutput);
            break;
        case 'union':
            type.members.forEach(t => collectOutputTypeNodeRefs(t, out, modelsWithOutput));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => collectOutputTypeNodeRefs(t, out, modelsWithOutput));
            break;
        case 'intersection':
            type.members.forEach(t => collectOutputTypeNodeRefs(t, out, modelsWithOutput));
            break;
        case 'lazy':
            collectOutputTypeNodeRefs(type.inner, out, modelsWithOutput);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectOutputTypeNodeRefs(f.type, out, modelsWithOutput));
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

/** Collect Input variant refs for request-side ParamSource types. */
function collectParamSourceInputRefs(source: ParamSource | undefined, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!source || !modelsWithInput) return;
    if (source.kind === 'ref') {
        if (modelsWithInput.has(source.name)) out.add(`${source.name}Input`);
    } else if (source.kind === 'type') {
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
        case 'tuple':
            type.items.forEach(t => collectInputTypeNodeRefs(t, out, modelsWithInput));
            break;
        case 'record':
            collectInputTypeNodeRefs(type.key, out, modelsWithInput);
            collectInputTypeNodeRefs(type.value, out, modelsWithInput);
            break;
        case 'union':
            type.members.forEach(t => collectInputTypeNodeRefs(t, out, modelsWithInput));
            break;
        case 'discriminatedUnion':
            type.members.forEach(t => collectInputTypeNodeRefs(t, out, modelsWithInput));
            break;
        case 'intersection':
            type.members.forEach(t => collectInputTypeNodeRefs(t, out, modelsWithInput));
            break;
        case 'lazy':
            collectInputTypeNodeRefs(type.inner, out, modelsWithInput);
            break;
        case 'inlineObject':
            type.fields.forEach(f => collectInputTypeNodeRefs(f.type, out, modelsWithInput));
            break;
    }
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

function collectServices(root: OpRootNode): string[] {
    const services = new Set<string>();
    const inferredService = `${deriveBaseName(root.file)}Service`;

    for (const route of root.routes) {
        for (const op of route.operations) {
            if (op.service) {
                services.add(op.service.split('.')[0] ?? op.service);
            } else {
                services.add(inferredService);
            }
        }
    }
    return [...services].sort();
}






function isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

// ─── Naming conventions ────────────────────────────────────────────────────

/**
 * Derive the PascalCase base name used for router, service, and type names from a contract file path.
 *
 * Strips directories and the `.op`/`.ck` extension, then PascalCases each dot-separated segment
 * (`contracts/ledger.categories.ck` → `LedgerCategories`). Falls back to `Resource` for an empty path.
 */
export function deriveBaseName(file: string): string {
    const base =
        file
            .split('/')
            .pop()
            ?.replace(/\.(op|ck)$/, '') ?? 'Resource';
    // ledger.categories -> LedgerCategories
    return base
        .split('.')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
}

function deriveRouterName(file: string): string {
    return `${deriveBaseName(file)}Router`;
}

/**
 * Resolve the import specifier for a service class.
 *
 * Drops the trailing `Service` suffix and kebab-cases the remainder, then applies `template` if given
 * (`{name}` → `Ledger`, `{kebab}` → `ledger`). Without a template, defaults to
 * `#modules/<kebab>/<kebab>.service.js`.
 *
 * @param template Optional `servicePathTemplate` from the plugin config.
 */
export function deriveModulePath(serviceName: string, template?: string): string {
    // LedgerService -> #modules/ledger/ledger.service.js
    const base = serviceName.replace(/Service$/, '');
    const kebab = base.replace(/([A-Z])/g, m => `-${m.toLowerCase()}`).replace(/^-/, '');
    if (template) {
        return template.replace(/\{name\}/g, base).replace(/\{kebab\}/g, kebab);
    }
    return `#modules/${kebab}/${kebab}.service.js`;
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
