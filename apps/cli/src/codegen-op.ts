import type {
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpResponseNode,
} from './ast.js';
import { renderType } from './codegen-dto.js';

// ─── Public entry point ────────────────────────────────────────────────────

export function generateOp(root: OpRootNode): string {
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
    const modulePath = deriveModulePath(svc);
    lines.push(`import { ${svc} } from '${modulePath}';`);
  }

  if (types.length > 0) {
    // Group types by module (heuristic: infer from file path)
    const typeImport = deriveTypeImportPath(root.file);
    lines.push(`import { ${types.join(', ')} } from '${typeImport}';`);
  }

  if (needsParseAndValidate) {
    lines.push(`import { parseAndValidate } from '#src/shared/validator.js';`);
  }

  lines.push('');
  lines.push(`export const ${routerName} = ServerKitRouter();`);
  lines.push('');

  for (const route of root.routes) {
    for (const op of route.operations) {
      lines.push(...generateHandler(route, op, root.file));
      lines.push('');
    }
  }

  lines.push('');
  lines.push(`// Register in apps/api/src/routes/routes.setup.ts:`);
  lines.push(`// import { ${routerName} } from './${deriveRouterFilename(root.file)}';`);
  lines.push(`// server.use(${routerName}.routes()).use(${routerName}.allowedMethods());`);

  return lines.join('\n');
}

// ─── Handler generation ────────────────────────────────────────────────────

function generateHandler(route: OpRouteNode, op: OpOperationNode, file: string): string[] {
  const lines: string[] = [];
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

  // Params validation
  if (route.params) {
    if (typeof route.params === 'string') {
      lines.push(`    const params = await parseAndValidate(ctx.params, ${route.params});`);
      lines.push('');
    } else if (route.params.length > 0) {
      lines.push(`    const { ${route.params.map(p => p.name).join(', ')} } = await parseAndValidate(`);
      lines.push(`        ctx.params,`);
      lines.push(`        z.strictObject({`);
      for (const param of route.params) {
        lines.push(`            ${param.name}: ${renderScalarParam(param)},`);
      }
      lines.push(`        }),`);
      lines.push(`    );`);
      lines.push('');
    }
  }

  // Query validation
  if (op.query) {
    if (typeof op.query === 'string') {
      lines.push(`    const query = await parseAndValidate(ctx.query, ${op.query});`);
      lines.push('');
    } else if (op.query.length > 0) {
      lines.push(`    const { ${op.query.map(p => p.name).join(', ')} } = await parseAndValidate(`);
      lines.push(`        ctx.query,`);
      lines.push(`        z.strictObject({`);
      for (const param of op.query) {
        lines.push(`            ${param.name}: ${renderScalarParam(param)},`);
      }
      lines.push(`        }),`);
      lines.push(`    );`);
      lines.push('');
    }
  }

  // Headers validation
  if (op.headers) {
    if (typeof op.headers === 'string') {
      lines.push(`    const headers = await parseAndValidate(ctx.headers, ${op.headers});`);
      lines.push('');
    } else if (op.headers.length > 0) {
      lines.push(`    const { ${op.headers.map(p => p.name).join(', ')} } = await parseAndValidate(`);
      lines.push(`        ctx.headers,`);
      lines.push(`        z.object({`);
      for (const param of op.headers) {
        lines.push(`            ${param.name}: ${renderScalarParam(param)},`);
      }
      lines.push(`        }).passthrough(),`);
      lines.push(`    );`);
      lines.push('');
    }
  }

  // Body validation
  if (hasBody && op.request) {
    if (isMultipart) {
      lines.push(`    const multipartBody = ctx.body as MultipartBody;`);
      lines.push('');
    } else {
      lines.push(`    const body = await parseAndValidate(ctx.body, ${op.request.bodyType});`);
      lines.push('');
    }
  }

  // Service call — use the first response with a body as the primary response
  const primaryResponse = op.responses.find(r => r.bodyType) ?? op.responses[0];
  const serviceParts = inferService(op, route, file);

  if (primaryResponse?.bodyType) {
    const typeAnnotation = formatTypeAnnotation(primaryResponse.bodyType);
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

function inferMethodName(
  method: string,
  path: string,
): string {
  const hasParam = path.includes(':');
  switch (method) {
    case 'get':    return hasParam ? 'getById' : 'list';
    case 'post':   return 'create';
    case 'put':    return 'replace';
    case 'patch':  return 'update';
    case 'delete': return 'delete';
    default:       return 'handle';
  }
}

function buildArgs(route: OpRouteNode, op: OpOperationNode): string {
  const args: string[] = [];
  if (route.params) {
    if (typeof route.params === 'string') {
      // Type-reference form: pass the validated params object
      // (individual field names are not known at compile time)
    } else {
      args.push(...route.params.map(p => p.name));
    }
  }
  if (op.request && op.request.contentType !== 'multipart/form-data') {
    args.push('body');
  }
  if (op.request && op.request.contentType === 'multipart/form-data') {
    args.push('multipartBody');
  }
  return args.join(', ');
}

function formatTypeAnnotation(bodyType: string): string {
  // array(X) -> X[]
  const arrayMatch = bodyType.match(/^array\((.+)\)$/);
  if (arrayMatch?.[1]) return `${arrayMatch[1]}[]`;
  return bodyType;
}

function renderScalarParam(param: OpParamNode): string {
  if (param.type.kind === 'scalar') {
    switch (param.type.name) {
      case 'uuid':   return 'z.uuid()';
      case 'int':    return 'z.int()';
      case 'string': return 'z.string()';
      default:       return 'z.string()';
    }
  }
  return 'z.string()';
}

// ─── Collection helpers ────────────────────────────────────────────────────

function collectTypes(root: OpRootNode): string[] {
  const types = new Set<string>();
  for (const route of root.routes) {
    if (typeof route.params === 'string') extractTypeNames(route.params, types);
    for (const op of route.operations) {
      if (op.request?.bodyType) extractTypeNames(op.request.bodyType, types);
      for (const resp of op.responses) {
        if (resp.bodyType) extractTypeNames(resp.bodyType, types);
      }
      if (typeof op.query === 'string') extractTypeNames(op.query, types);
      if (typeof op.headers === 'string') extractTypeNames(op.headers, types);
    }
  }
  return [...types].sort();
}

function extractTypeNames(typeStr: string, out: Set<string>): void {
  // array(SomeType) -> SomeType
  const arrayMatch = typeStr.match(/^array\((.+)\)$/);
  if (arrayMatch?.[1]) {
    extractTypeNames(arrayMatch[1], out);
    return;
  }
  // Plain identifier (PascalCase = model reference)
  if (/^[A-Z]/.test(typeStr)) {
    out.add(typeStr);
  }
}

function collectServices(root: OpRootNode): string[] {
  const services = new Set<string>();
  for (const route of root.routes) {
    for (const op of route.operations) {
      if (op.service) {
        services.add(op.service.split('.')[0] ?? op.service);
      }
    }
  }
  // If none explicitly declared, infer one
  if (services.size === 0) {
    const baseName = deriveBaseName(root.file);
    services.add(`${baseName}Service`);
  }
  return [...services].sort();
}

function hasParamSource(source?: import('./ast.js').ParamSource): boolean {
  if (!source) return false;
  if (typeof source === 'string') return true;
  return source.length > 0;
}

function routeNeedsValidation(root: OpRootNode): boolean {
  return root.routes.some(r =>
    hasParamSource(r.params) ||
    r.operations.some(op =>
      !!op.request ||
      hasParamSource(op.query) ||
      hasParamSource(op.headers)
    )
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

function deriveModulePath(serviceName: string): string {
  // LedgerService -> #modules/ledger/ledger.service.js
  const base = serviceName.replace(/Service$/, '');
  const kebab = base.replace(/([A-Z])/g, m => `-${m.toLowerCase()}`).replace(/^-/, '');
  return `#modules/${kebab}/${kebab}.service.js`;
}

function deriveTypeImportPath(file: string): string {
  const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'resource';
  const module = base.split('.')[0] ?? base;
  return `#modules/${module}/types/index.js`;
}
