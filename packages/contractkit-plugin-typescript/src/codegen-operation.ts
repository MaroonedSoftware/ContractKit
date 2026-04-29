import type { OpRootNode, OpRouteNode, OpOperationNode, ContractTypeNode, ParamSource, ObjectMode } from '@contractkit/core';
import { resolveModifiers, resolveSecurity, SECURITY_NONE, classifyContentType } from '@contractkit/core';
import {
    renderType,
    renderInputType,
    renderQueryType,
    pascalToDotCase,
    typeNeedsDateTime,
    typeNeedsScalar,
    modeToWrapper,
} from './codegen-contract.js';
import { renderOutputTsType, quoteKey, headerNameToProperty } from './ts-render.js';
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
            return a.name === bb.name && a.min === bb.min && a.max === bb.max && a.len === bb.len && a.regex === bb.regex && a.format === bb.format;
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
}

export function generateOp(root: OpRootNode, options: OpCodegenOptions = {}): string {
    // Collect all referenced types across all routes
    const types = collectTypes(root, options.modelsWithInput, options.modelsWithOutput);
    const services = collectServices(root);
    const routerName = deriveRouterName(root.file);
    const needsParseAndValidate = routeNeedsValidation(root);

    // Generate the body first so we can detect whether `z.` is actually referenced
    // before deciding whether to emit the zod import.
    const body: string[] = [];
    const needsSignature = fileNeedsSignature(root);
    const needsSecurity = fileNeedsSecurity(root);
    const koaImports = ['ServerKitRouter', 'bodyParserMiddleware'];
    if (needsSecurity) koaImports.push('requireSecurity');
    if (needsSignature) koaImports.push('requireSignature');
    body.push(`import { ${koaImports.join(', ')} } from '@maroonedsoftware/koa';`);

    for (const svc of services) {
        const modulePath = root.services?.[svc] ?? root.meta[svc] ?? deriveModulePath(svc, options.servicePathTemplate);
        body.push(`import { ${svc} } from '${modulePath}';`);
    }

    if (types.length > 0) {
        body.push(...generateTypeImports(types, root.file, options));
    }

    if (opNeedsDateTime(root)) {
        body.push(`import { DateTime } from 'luxon';`);
    }

    if (needsParseAndValidate) {
        body.push(`import { parseAndValidate } from '@maroonedsoftware/zod';`);
    }

    const helpers: string[] = [];
    if (opNeedsScalar(root, 'binary')) {
        helpers.push(`const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });`);
    }
    if (opNeedsScalar(root, 'datetime')) {
        helpers.push(
            `const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));`,
        );
    }
    if (opNeedsScalar(root, 'json')) {
        helpers.push(`type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };`);
        helpers.push(
            `const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));`,
        );
    }

    const lines: string[] = [];

    lines.push('');
    lines.push('/**');
    const relFile = options.outPath ? relative(dirname(options.outPath), root.file) : root.file;
    lines.push(` * generated from [${basename(root.file)}](file://./${relFile})`);
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
        lines.push(` * ${desc}`);
    }
    // Source location comment
    const relFile = outPath ? relative(dirname(outPath), file) : file;
    lines.push(` * from [${basename(file)}](file://./${relFile}#L${op.loc.line})`);

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
        const roles = effectiveSecurity && effectiveSecurity.roles?.length ? `roles: [${effectiveSecurity.roles.map(r => `'${r}'`).join(', ')}]` : '';
        middlewares.push(`requireSecurity({ ${roles} })`);
    }
    if (hasBody) {
        const parserTokens = Array.from(new Set(bodies.map(b => bodyParserToken(b.contentType))));
        const tokensExpr = parserTokens.map(t => `'${t}'`).join(', ');
        middlewares.push(`bodyParserMiddleware([${tokensExpr}])`);
    }
    if (op.signature) {
        middlewares.push(`requireSignature('${op.signature}')`);
    }
    const middlewareStr = middlewares.length > 0 ? `, ${middlewares.join(', ')},` : ',';

    lines.push(`${deriveRouterName(file)}.${method}('${path}'${middlewareStr} async (ctx, next) => {`);

    // Params / query / headers validation (request-side — use Input variants)
    lines.push(...generateParamValidation(route.params, 'ctx.params', 'params', route.paramsMode ?? 'strict', '', modelsWithInput));
    lines.push(...generateParamValidation(op.query, 'ctx.query', 'query', op.queryMode ?? 'strict', '', modelsWithInput));
    lines.push(...generateParamValidation(op.headers, 'ctx.headers', 'headers', op.headersMode ?? 'strip', '', modelsWithInput));

    // Body validation (request-side — use Input variants)
    if (hasBody && op.request) {
        if (isSingleMultipart) {
            lines.push(`    const multipartBody = ctx.body as MultipartBody;`);
            lines.push('');
        } else if (bodies.length === 1) {
            lines.push(`    const body = await parseAndValidate(ctx.body, ${renderInputType(bodies[0]!.bodyType, modelsWithInput)});`);
            lines.push('');
        } else if (bodies.every(b => bodyTypesStructurallyEqual(b.bodyType, bodies[0]!.bodyType))) {
            // All declared MIMEs share the same body shape — single validation suffices
            lines.push(`    const body = await parseAndValidate(ctx.body, ${renderInputType(bodies[0]!.bodyType, modelsWithInput)});`);
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
                    lines.push(`            body = ctx.body as MultipartBody;`);
                } else {
                    lines.push(`            body = await parseAndValidate(ctx.body, ${renderInputType(b.bodyType, modelsWithInput)});`);
                }
                lines.push(`            break;`);
            }
            lines.push(`    }`);
            lines.push('');
        }
    }

    // Service call — use the first response with a body as the primary response
    const primaryResponse = op.responses.find(r => r.bodyType) ?? op.responses[0];
    const serviceParts = inferService(op, route, file);
    const respHeaders = primaryResponse?.headers ?? [];
    const hasRespHeaders = respHeaders.length > 0;
    const headersAnnotation = hasRespHeaders
        ? `{ ${respHeaders
              .map(h => `${quoteKey(headerNameToProperty(h.name))}${h.optional ? '?' : ''}: ${renderOutputTsType(h.type, options.modelsWithOutput)}`)
              .join('; ')} }`
        : '';

    if (primaryResponse?.bodyType) {
        const { annotation, prelude } = formatTypeAnnotation(primaryResponse.bodyType!, options.modelsWithOutput);
        if (prelude) {
            lines.push(`    ${prelude}`);
        }
        lines.push(`    const service = ctx.container.get(${serviceParts.className});`);
        if (hasRespHeaders) {
            lines.push(
                `    const result: { body: ${annotation}; headers: ${headersAnnotation} } = await service.${serviceParts.methodName}(${buildArgs(route, op)});`,
            );
        } else {
            lines.push(`    const result: ${annotation} = await service.${serviceParts.methodName}(${buildArgs(route, op)});`);
        }
    } else {
        lines.push(`    const service = ctx.container.get(${serviceParts.className});`);
        if (hasRespHeaders) {
            lines.push(`    const result: { headers: ${headersAnnotation} } = await service.${serviceParts.methodName}(${buildArgs(route, op)});`);
        } else {
            lines.push(`    await service.${serviceParts.methodName}(${buildArgs(route, op)});`);
        }
    }

    lines.push('');
    lines.push(`    ctx.status = ${primaryResponse?.statusCode ?? 200};`);

    if (hasRespHeaders) {
        for (const h of respHeaders) {
            const accessor = `result.headers[${JSON.stringify(headerNameToProperty(h.name))}]`;
            if (h.optional) {
                lines.push(`    if (${accessor} !== undefined) ctx.set('${h.name}', String(${accessor}));`);
            } else {
                lines.push(`    ctx.set('${h.name}', String(${accessor}));`);
            }
        }
    }

    if (primaryResponse?.bodyType && primaryResponse.contentType) {
        lines.push(`    ctx.type = '${primaryResponse.contentType}';`);
        lines.push(`    ctx.body = ${hasRespHeaders ? 'result.body' : 'result'};`);
    }

    lines.push('');
    lines.push(`    await next();`);
    lines.push(`});`);

    return lines;
}

// ─── Inference helpers ─────────────────────────────────────────────────────

function inferService(op: OpOperationNode, route: OpRouteNode, file: string): { className: string; methodName: string } {
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

function buildArgs(route: OpRouteNode, op: OpOperationNode): string {
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

function formatTypeAnnotation(bodyType: ContractTypeNode, modelsWithOutput?: Set<string>): { annotation: string; prelude?: string } {
    if (bodyType.kind === 'array') {
        const inner = formatTypeAnnotation(bodyType.item, modelsWithOutput);
        return { annotation: `${inner.annotation}[]`, prelude: inner.prelude };
    }
    if (bodyType.kind === 'ref') {
        const name = modelsWithOutput?.has(bodyType.name) ? `${bodyType.name}Output` : bodyType.name;
        return { annotation: name };
    }
    if (bodyType.kind === 'scalar') return { annotation: bodyType.name };
    // For complex types, extract schema into a variable so the result line stays readable
    const schema = renderType(bodyType);
    return {
        annotation: 'z.infer<typeof resultType>',
        prelude: `const resultType = ${schema};`,
    };
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

function paramSourceNeedsDateTime(source: ParamSource | undefined): boolean {
    if (!source) return false;
    if (source.kind === 'ref') return false;
    if (source.kind === 'params') return source.nodes.some(p => typeNeedsDateTime(p.type));
    return typeNeedsDateTime(source.node);
}

function opNeedsDateTime(root: OpRootNode): boolean {
    return root.routes.some(
        route =>
            paramSourceNeedsDateTime(route.params) ||
            route.operations.some(
                op =>
                    !!op.request?.bodies.some(b => typeNeedsDateTime(b.bodyType)) ||
                    op.responses.some(r => r.bodyType && typeNeedsDateTime(r.bodyType)) ||
                    paramSourceNeedsDateTime(op.query) ||
                    paramSourceNeedsDateTime(op.headers),
            ),
    );
}

function paramSourceNeedsScalar(source: ParamSource | undefined, name: string): boolean {
    if (!source) return false;
    if (source.kind === 'ref') return false;
    if (source.kind === 'params') return source.nodes.some(p => typeNeedsScalar(p.type, name));
    return typeNeedsScalar(source.node, name);
}

function opNeedsScalar(root: OpRootNode, name: string): boolean {
    return root.routes.some(
        route =>
            paramSourceNeedsScalar(route.params, name) ||
            route.operations.some(
                op =>
                    !!op.request?.bodies.some(b => typeNeedsScalar(b.bodyType, name)) ||
                    op.responses.some(r => r.bodyType && typeNeedsScalar(r.bodyType, name)) ||
                    paramSourceNeedsScalar(op.query, name) ||
                    paramSourceNeedsScalar(op.headers, name),
            ),
    );
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

function hasParamSource(source?: ParamSource): boolean {
    if (!source) return false;
    if (source.kind === 'ref') return true;
    if (source.kind === 'params') return source.nodes.length > 0;
    return true; // type
}

function routeNeedsValidation(root: OpRootNode): boolean {
    return root.routes.some(
        r => hasParamSource(r.params) || r.operations.some(op => !!op.request || hasParamSource(op.query) || hasParamSource(op.headers)),
    );
}

function fileNeedsSecurity(root: OpRootNode): boolean {
    return root.routes.some(route => route.operations.some(op => resolveSecurity(route, op, root) !== SECURITY_NONE));
}

function fileNeedsSignature(root: OpRootNode): boolean {
    return root.routes.some(route => route.operations.some(op => !!op.signature));
}

function isValidIdentifier(name: string): boolean {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

// ─── Naming conventions ────────────────────────────────────────────────────

function deriveBaseName(file: string): string {
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

function deriveModulePath(serviceName: string, template?: string): string {
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
