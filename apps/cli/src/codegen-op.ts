import type { OpRootNode, OpRouteNode, OpOperationNode, OpParamNode, OpResponseNode, DtoTypeNode, ParamSource } from './ast.js';
import { renderType, pascalToDotCase } from './codegen-dto.js';
import { basename, dirname, relative } from 'path';

// ─── Public entry point ────────────────────────────────────────────────────

export interface OpCodegenOptions {
    servicePathTemplate?: string;
    typeImportPathTemplate?: string;
    outPath?: string;
    /** Map from model name → absolute output file path (for cross-module type imports) */
    modelOutPaths?: Map<string, string>;
}

export function generateOp(root: OpRootNode, options: OpCodegenOptions = {}): string {
    const lines: string[] = [];

    // Collect all referenced types across all routes
    const types = collectTypes(root);
    const services = collectServices(root);
    const routerName = deriveRouterName(root.file);
    const needsParseAndValidate = routeNeedsValidation(root);

    // Imports
    lines.push(`import { z } from 'zod';`);
    lines.push(`import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';`);

    for (const svc of services) {
        const modulePath = root.meta[svc] ?? deriveModulePath(svc, options.servicePathTemplate);
        lines.push(`import { ${svc} } from '${modulePath}';`);
    }

    if (types.length > 0) {
        lines.push(...generateTypeImports(types, root.file, options));
    }

    if (needsParseAndValidate) {
        lines.push(`import { parseAndValidate } from '#src/shared/validator.js';`);
    }

    lines.push('');
    lines.push('/**');
    const relFile = options.outPath ? relative(dirname(options.outPath), root.file) : root.file;
    lines.push(` * generated from [${basename(root.file)}](file://./${relFile})`);
    lines.push('*/');
    lines.push(`export const ${routerName} = ServerKitRouter();`);
    lines.push('');

    for (const route of root.routes) {
        for (const op of route.operations) {
            lines.push(...generateHandler(route, op, root.file, options.outPath));
            lines.push('');
        }
    }

    return lines.join('\n');
}

// ─── Handler generation ────────────────────────────────────────────────────

function generateHandler(route: OpRouteNode, op: OpOperationNode, file: string, outPath?: string): string[] {
    const lines: string[] = [];

    lines.push('/**');

    // JSDoc from description
    const desc = op.description ?? route.description;
    if (desc) {
        lines.push(` * ${desc}`);
    }
    // Source location comment
    const relFile = outPath ? relative(dirname(outPath), file) : file;
    lines.push(` * from [${basename(file)}](file://./${relFile}#L${op.loc.line})`);
    lines.push('*/');

    const method = op.method;
    const path = route.path;
    const hasBody = !!op.request;
    const isMultipart = op.request?.contentType === 'multipart/form-data';

    // Middleware list
    const middlewares: string[] = [];
    if (hasBody) {
        middlewares.push(isMultipart ? `bodyParserMiddleware(['multipart'])` : `bodyParserMiddleware(['json'])`);
    }
    const middlewareStr = middlewares.length > 0 ? `, ${middlewares.join(', ')},` : ',';

    lines.push(`${deriveRouterName(file)}.${method}('${path}'${middlewareStr} async (ctx, next) => {`);

    // Params / query / headers validation
    lines.push(...generateParamValidation(route.params, 'ctx.params', 'params', 'z.strictObject'));
    lines.push(...generateParamValidation(op.query, 'ctx.query', 'query', 'z.strictObject'));
    lines.push(...generateParamValidation(op.headers, 'ctx.headers', 'headers', 'z.object', '.passthrough()'));

    // Body validation
    if (hasBody && op.request) {
        if (isMultipart) {
            lines.push(`    const multipartBody = ctx.body as MultipartBody;`);
            lines.push('');
        } else {
            lines.push(`    const body = await parseAndValidate(ctx.body, ${renderType(op.request.bodyType)});`);
            lines.push('');
        }
    }

    // Service call — use the first response with a body as the primary response
    const primaryResponse = op.responses.find(r => r.bodyType) ?? op.responses[0];
    const serviceParts = inferService(op, route, file);

    if (primaryResponse?.bodyType) {
        const typeAnnotation = formatTypeAnnotation(primaryResponse.bodyType!);
        lines.push(`    const service = ctx.container.get(${serviceParts.className});`);
        lines.push(`    const result: ${typeAnnotation} = await service.${serviceParts.methodName}(${buildArgs(route, op)});`);
    } else {
        lines.push(`    const service = ctx.container.get(${serviceParts.className});`);
        lines.push(`    await service.${serviceParts.methodName}(${buildArgs(route, op)});`);
    }

    lines.push('');
    lines.push(`    ctx.status = ${primaryResponse?.statusCode ?? 200};`);

    if (primaryResponse?.bodyType && primaryResponse.contentType) {
        lines.push(`    ctx.type = 'application/json';`);
        lines.push(`    ctx.body = result;`);
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
    const hasParam = path.includes(':');
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
    // Path params: spread individually (inline) or pass 'params' object (type-ref/DtoTypeNode)
    if (route.params) {
        if (Array.isArray(route.params)) {
            args.push(...route.params.map(p => p.name));
        } else {
            args.push('params');
        }
    }
    // Body
    if (op.request) {
        args.push(op.request.contentType === 'multipart/form-data' ? 'multipartBody' : 'body');
    }
    // Query
    if (op.query) args.push('query');
    // Headers
    if (op.headers) args.push('headers');
    return args.join(', ');
}

function formatTypeAnnotation(bodyType: DtoTypeNode): string {
    if (bodyType.kind === 'array') {
        return `${formatTypeAnnotation(bodyType.item)}[]`;
    }
    if (bodyType.kind === 'ref') return bodyType.name;
    if (bodyType.kind === 'scalar') return bodyType.name;
    // For complex types, fall back to z.infer
    return `z.infer<typeof ${renderType(bodyType)}>`;
}

function generateParamValidation(source: ParamSource | undefined, ctxExpr: string, varName: string, schemaWrapper: string, suffix = ''): string[] {
    if (!source) return [];
    const lines: string[] = [];
    if (typeof source === 'string') {
        // Type reference name
        lines.push(`    const ${varName} = await parseAndValidate(${ctxExpr}, ${source});`);
        lines.push('');
    } else if (Array.isArray(source)) {
        // Inline param declarations
        if (source.length > 0) {
            // Destructure only for params (spread individually in service call);
            // query/headers are passed as whole objects.
            const lhs = varName === 'params' ? `{ ${source.map(p => p.name).join(', ')} }` : varName;
            lines.push(`    const ${lhs} = await parseAndValidate(`);
            lines.push(`        ${ctxExpr},`);
            lines.push(`        ${schemaWrapper}({`);
            for (const param of source) {
                lines.push(`            ${param.name}: ${renderType(param.type)},`);
            }
            lines.push(`        })${suffix},`);
            lines.push(`    );`);
            lines.push('');
        }
    } else {
        // DtoTypeNode
        lines.push(`    const ${varName} = await parseAndValidate(${ctxExpr}, ${renderType(source)});`);
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

function collectTypes(root: OpRootNode): string[] {
    const types = new Set<string>();
    for (const route of root.routes) {
        collectParamSourceRefs(route.params, types);
        for (const op of route.operations) {
            if (op.request?.bodyType) collectTypeNodeRefs(op.request.bodyType, types);
            for (const resp of op.responses) {
                if (resp.bodyType) collectTypeNodeRefs(resp.bodyType, types);
            }
            collectParamSourceRefs(op.query, types);
            collectParamSourceRefs(op.headers, types);
        }
    }
    return [...types].sort();
}

function collectParamSourceRefs(source: ParamSource | undefined, out: Set<string>): void {
    if (!source) return;
    if (typeof source === 'string') {
        if (/^[A-Z]/.test(source)) out.add(source);
    } else if (Array.isArray(source)) {
        for (const param of source) {
            collectTypeNodeRefs(param.type, out);
        }
    } else {
        collectTypeNodeRefs(source, out);
    }
}

function collectTypeNodeRefs(type: DtoTypeNode, out: Set<string>): void {
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

function hasParamSource(source?: ParamSource): boolean {
    if (!source) return false;
    if (typeof source === 'string') return true;
    if (Array.isArray(source)) return source.length > 0;
    return true; // DtoTypeNode
}

function routeNeedsValidation(root: OpRootNode): boolean {
    return root.routes.some(
        r => hasParamSource(r.params) || r.operations.some(op => !!op.request || hasParamSource(op.query) || hasParamSource(op.headers)),
    );
}

// ─── Naming conventions ────────────────────────────────────────────────────

function deriveBaseName(file: string): string {
    const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'Resource';
    // ledger.categories -> LedgerCategories
    return base
        .split('.')
        .map(s => s.charAt(0).toUpperCase() + s.slice(1))
        .join('');
}

function deriveRouterName(file: string): string {
    return `${deriveBaseName(file)}Router`;
}

function deriveRouterFilename(file: string): string {
    const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'resource';
    return `${base}.router`;
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
    const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'resource';
    const module = base.split('.')[0] ?? base;
    if (template) {
        return template.replace(/\{module\}/g, module).replace(/\{base\}/g, base);
    }
    return `#modules/${module}/types/index.js`;
}