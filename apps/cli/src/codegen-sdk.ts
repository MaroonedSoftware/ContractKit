import type { OpRootNode, OpRouteNode, OpOperationNode, OpParamNode, DtoTypeNode, ParamSource, FieldNode } from './ast.js';
import { pascalToDotCase } from './codegen-dto.js';
import { basename, dirname, relative } from 'path';

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
    /** Default security scheme from config — used when op.security is not set */
    defaultSecurity?: string;
}

export function generateSdk(root: OpRootNode, options: SdkCodegenOptions = {}): string {
    const lines: string[] = [];

    const types = collectTypes(root, options.modelsWithInput);
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
        lines.push(`import type { SdkFetch } from '${rel}';`);
        lines.push(`import { SdkError, bigIntReplacer, bigIntReviver } from '${rel}';`);
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
        lines.push('export interface SecurityContext {');
        lines.push('    scheme: string;');
        lines.push('}');
        lines.push('');
        lines.push('export type SecurityHandler = (ctx: SecurityContext) => Record<string, string> | Promise<Record<string, string>>;');
        lines.push('');
        lines.push('export type SdkFetch = (url: string, init: RequestInit, security?: SecurityContext) => Promise<Response>;');
        lines.push('');
        lines.push('export interface SdkOptions {');
        lines.push('    baseUrl: string;');
        lines.push('    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);');
        lines.push('    fetch?: SdkFetch;');
        lines.push('    /** Called once per request to produce a unique X-Request-ID header value */');
        lines.push('    requestIdFactory?: () => string;');
        lines.push('    securityHandler?: SecurityHandler;');
        lines.push('}');
        lines.push('');
        lines.push('export function createSdkFetch(options: SdkOptions): SdkFetch {');
        lines.push('    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());');
        lines.push('    return async (url: string, init: RequestInit, security?: SecurityContext): Promise<Response> => {');
        lines.push('        const baseHeaders = typeof options.headers === \'function\'');
        lines.push('            ? await options.headers()');
        lines.push('            : options.headers ?? {};');
        lines.push('        const securityHeaders = security && options.securityHandler');
        lines.push('            ? await options.securityHandler(security)');
        lines.push('            : {};');
        lines.push('        const res = await fetch(`${options.baseUrl}${url}`, {');
        lines.push('            ...init,');
        lines.push('            headers: { ...baseHeaders, ...securityHeaders, \'X-Request-ID\': getRequestId(), ...init.headers as Record<string, string> },');
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
            lines.push('');
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
    const { modelsWithInput } = options;

    // Resolve effective security scheme (operation-level wins over config default)
    const scheme = op.security?.[0]?.name ?? options.defaultSecurity;
    const isPublic = !scheme || scheme === 'none';
    const securityArg = isPublic ? '' : `, { scheme: '${scheme}' }`;

    // Build method parameters (request-side — use Input variants)
    const params = buildMethodParams(route, op, modelsWithInput);
    const paramStr = params.map(p => `${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ');

    // Determine return type
    const primaryResponse = op.responses.find(r => r.bodyType) ?? op.responses[0];
    const isVoid = !primaryResponse?.bodyType;
    const returnType = isVoid ? 'void' : renderTsType(primaryResponse!.bodyType!);

    // JSDoc
    const desc = op.description ?? route.description;
    if (desc) {
        lines.push(`    /** ${desc} */`);
    }

    lines.push(`    async ${methodName}(${paramStr}): Promise<${returnType}> {`);

    // Build URL with path params
    const urlExpr = buildUrlExpression(route.path, route.params);

    // Query string
    const hasQuery = !!op.query;
    let fetchUrl = urlExpr;
    if (hasQuery) {
        lines.push(`        const searchParams = new URLSearchParams();`);
        lines.push(`        if (query) {`);
        lines.push(`            for (const [k, v] of Object.entries(query)) {`);
        lines.push(`                if (v === undefined || v === null) continue;`);
        lines.push(`                if (Array.isArray(v)) { for (const item of v) searchParams.append(k, String(item)); }`);
        lines.push(`                else searchParams.set(k, String(v));`);
        lines.push(`            }`);
        lines.push(`        }`);
        lines.push(`        const qs = searchParams.toString();`);
        fetchUrl = urlExpr;
    }

    // Build fetch options
    const hasBody = !!op.request;
    const isMultipart = op.request?.contentType === 'multipart/form-data';
    const hasOpHeaders = !!op.headers;

    const fetchArgs: string[] = [];

    if (hasQuery) {
        fetchArgs.push(`url: qs ? \`${fetchUrl}?\${qs}\` : \`${fetchUrl}\``);
    } else {
        fetchArgs.push(`url: \`${fetchUrl}\``);
    }

    fetchArgs.push(`method: '${httpMethod}'`);

    if (hasBody) {
        if (isMultipart) {
            fetchArgs.push('body: body');
        } else {
            fetchArgs.push(`headers: { 'Content-Type': 'application/json' }`);
            fetchArgs.push('body: JSON.stringify(body, bigIntReplacer)');
        }
    }

    if (hasOpHeaders) {
        if (hasBody && !isMultipart) {
            const lastIdx = fetchArgs.findIndex(a => a.startsWith('headers:'));
            fetchArgs[lastIdx] = `headers: { 'Content-Type': 'application/json', ...customHeaders }`;
        } else {
            fetchArgs.push('headers: customHeaders');
        }
    }

    if (fetchArgs.length === 2 && !hasBody && !hasOpHeaders && !hasQuery) {
        // Simple case — inline
        lines.push(`        const result = await this.fetch(\`${fetchUrl}\`, { method: '${httpMethod}' }${securityArg});`);
    } else {
        lines.push(`        const result = await this.fetch(${fetchArgs[0]!.split(': ').slice(1).join(': ')}, {`);
        for (let i = 1; i < fetchArgs.length; i++) {
            lines.push(`            ${fetchArgs[i]},`);
        }
        lines.push(`        }${securityArg});`);
    }

    if (isVoid) {
        lines.push(`        await result.text();`);
    } else {
        lines.push(`        return JSON.parse(await result.text(), bigIntReviver) as ${returnType};`);
    }

    lines.push('    }');

    return lines;
}

// ─── URL building ─────────────────────────────────────────────────────────

function buildUrlExpression(path: string, params?: ParamSource): string {
    // Replace :paramName with ${encodeURIComponent(paramName)}
    return path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
        return `\${encodeURIComponent(String(${name}))}`;
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
        if (Array.isArray(route.params)) {
            for (const p of route.params) {
                params.push({ name: p.name, type: renderInputTsType(p.type, modelsWithInput), optional: false });
            }
        } else if (typeof route.params === 'string') {
            const typeName = modelsWithInput?.has(route.params) ? `${route.params}Input` : route.params;
            params.push({ name: 'params', type: typeName, optional: false });
        } else {
            params.push({ name: 'params', type: renderInputTsType(route.params, modelsWithInput), optional: false });
        }
    }

    // Body (request-side — use Input variants)
    if (op.request) {
        if (op.request.contentType === 'multipart/form-data') {
            params.push({ name: 'body', type: 'FormData', optional: false });
        } else {
            params.push({ name: 'body', type: renderInputTsType(op.request.bodyType, modelsWithInput), optional: false });
        }
    }

    // Query (request-side — use Input variants)
    if (op.query) {
        if (Array.isArray(op.query)) {
            const fields = op.query.map(p => `${p.name}?: ${renderInputTsType(p.type, modelsWithInput)}`).join('; ');
            params.push({ name: 'query', type: `{ ${fields} }`, optional: true });
        } else if (typeof op.query === 'string') {
            const typeName = modelsWithInput?.has(op.query) ? `${op.query}Input` : op.query;
            params.push({ name: 'query', type: typeName, optional: true });
        } else {
            params.push({ name: 'query', type: renderInputTsType(op.query, modelsWithInput), optional: true });
        }
    }

    // Headers (request-side — use Input variants)
    if (op.headers) {
        if (Array.isArray(op.headers)) {
            const fields = op.headers.map(p => `${p.name}?: ${renderInputTsType(p.type, modelsWithInput)}`).join('; ');
            params.push({ name: 'customHeaders', type: `{ ${fields} }`, optional: true });
        } else if (typeof op.headers === 'string') {
            const typeName = modelsWithInput?.has(op.headers) ? `${op.headers}Input` : op.headers;
            params.push({ name: 'customHeaders', type: typeName, optional: true });
        } else {
            params.push({ name: 'customHeaders', type: renderInputTsType(op.headers, modelsWithInput), optional: true });
        }
    }

    return params;
}

// ─── TypeScript type rendering ────────────────────────────────────────────

export function renderTsType(type: DtoTypeNode): string {
    switch (type.kind) {
        case 'scalar':
            return renderTsScalar(type.name);
        case 'array': {
            const inner = renderTsType(type.item);
            const needsParens = type.item.kind === 'union' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'tuple':
            return `[${type.items.map(renderTsType).join(', ')}]`;
        case 'record':
            return `Record<${renderTsType(type.key)}, ${renderTsType(type.value)}>`;
        case 'enum':
            return type.values.map(v => `'${v}'`).join(' | ');
        case 'literal':
            return typeof type.value === 'string' ? `'${type.value}'` : String(type.value);
        case 'union':
            return type.members.map(renderTsType).join(' | ');
        case 'intersection':
            return type.members.map(renderTsType).join(' & ');
        case 'ref':
            return type.name;
        case 'lazy':
            return renderTsType(type.inner);
        case 'inlineObject':
            return renderTsInlineObject(type.fields);
        default:
            return 'unknown';
    }
}

function renderTsScalar(name: string): string {
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
        case 'boolean':
            return 'boolean';
        case 'date':
        case 'datetime':
            return 'string';
        case 'null':
            return 'null';
        case 'any':
            return 'any';
        case 'unknown':
            return 'unknown';
        case 'object':
            return 'Record<string, unknown>';
        case 'binary':
            return 'Blob';
        default:
            return 'unknown';
    }
}

function renderTsInlineObject(fields: FieldNode[]): string {
    const entries = fields.map(f => {
        const opt = f.optional ? '?' : '';
        return `${f.name}${opt}: ${renderTsType(f.type)}`;
    });
    return `{ ${entries.join('; ')} }`;
}

/**
 * Like renderTsType, but substitutes model refs with their Input variant
 * when the model has visibility modifiers. Used for request-side types
 * (body, params, query, headers).
 */
export function renderInputTsType(type: DtoTypeNode, modelsWithInput?: Set<string>): string {
    if (!modelsWithInput || modelsWithInput.size === 0) return renderTsType(type);
    switch (type.kind) {
        case 'ref':
            return modelsWithInput.has(type.name) ? `${type.name}Input` : type.name;
        case 'array': {
            const inner = renderInputTsType(type.item, modelsWithInput);
            const needsParens = type.item.kind === 'union' || type.item.kind === 'intersection' || type.item.kind === 'enum';
            return needsParens ? `(${inner})[]` : `${inner}[]`;
        }
        case 'intersection':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' & ');
        case 'union':
            return type.members.map(m => renderInputTsType(m, modelsWithInput)).join(' | ');
        case 'inlineObject':
            return `{ ${type.fields.map(f => `${f.name}${f.optional ? '?' : ''}: ${renderInputTsType(f.type, modelsWithInput)}`).join('; ')} }`;
        case 'lazy':
            return renderInputTsType(type.inner, modelsWithInput);
        default:
            return renderTsType(type);
    }
}

// ─── Method name inference ────────────────────────────────────────────────

function deriveMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return op.sdk;
    return inferMethodName(op.method, route.path);
}

function inferMethodName(method: string, path: string): string {
    // Build a name from the path segments + method
    // e.g. GET /users/:id → getUsersById
    // e.g. POST /users → postUsers
    // e.g. DELETE /users/:id → deleteUsersById
    const segments = path.split('/').filter(s => s.length > 0);
    const parts: string[] = [method.toLowerCase()];

    for (const seg of segments) {
        if (seg.startsWith(':')) {
            // :id → ById, :accountId → ByAccountId
            const paramName = seg.slice(1);
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
    const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'Resource';
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

function collectTypes(root: OpRootNode, modelsWithInput?: Set<string>): string[] {
    const types = new Set<string>();
    for (const route of root.routes) {
        collectParamSourceRefs(route.params, types);
        collectParamSourceInputRefs(route.params, types, modelsWithInput);
        for (const op of route.operations) {
            if (op.request?.bodyType) {
                collectTypeNodeRefs(op.request.bodyType, types);
                collectInputTypeNodeRefs(op.request.bodyType, types, modelsWithInput);
            }
            for (const resp of op.responses) {
                if (resp.bodyType) collectTypeNodeRefs(resp.bodyType, types);
            }
            collectParamSourceRefs(op.query, types);
            collectParamSourceInputRefs(op.query, types, modelsWithInput);
            collectParamSourceRefs(op.headers, types);
            collectParamSourceInputRefs(op.headers, types, modelsWithInput);
        }
    }
    return [...types].sort();
}

/** Collect Input variant refs for request-side ParamSource types. */
function collectParamSourceInputRefs(source: ParamSource | undefined, out: Set<string>, modelsWithInput?: Set<string>): void {
    if (!source || !modelsWithInput) return;
    if (typeof source === 'string') {
        if (modelsWithInput.has(source)) out.add(`${source}Input`);
    } else if (Array.isArray(source)) {
        for (const param of source) {
            collectInputTypeNodeRefs(param.type, out, modelsWithInput);
        }
    } else {
        collectInputTypeNodeRefs(source, out, modelsWithInput);
    }
}

/** Collect Input variant refs for request-side DtoTypeNode types. */
function collectInputTypeNodeRefs(type: DtoTypeNode, out: Set<string>, modelsWithInput?: Set<string>): void {
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
    const base = file.split('/').pop()?.replace(/\.op$/, '') ?? 'resource';
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
        '        this.name = \'SdkError\';',
        '    }',
        '}',
        '',
        'export interface SecurityContext {',
        '    scheme: string;',
        '}',
        '',
        'export type SecurityHandler = (ctx: SecurityContext) => Record<string, string> | Promise<Record<string, string>>;',
        '',
        'export type SdkFetch = (url: string, init: RequestInit, security?: SecurityContext) => Promise<Response>;',
        '',
        'export interface SdkOptions {',
        '    baseUrl: string;',
        '    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);',
        '    fetch?: SdkFetch;',
        '    /** Called once per request to produce a unique X-Request-ID header value */',
        '    requestIdFactory?: () => string;',
        '    securityHandler?: SecurityHandler;',
        '}',
        '',
        'export const bigIntReplacer = (_: string, value: any): any => {',
        '    if (typeof value === \'bigint\') {',
        '        return value.toString() + \'n\';',
        '    }',
        '    return value;',
        '};',
        '',
        'export const bigIntReviver = (_: string, value: any): any => {',
        '    if (typeof value === \'string\' && /^-?\\d+n$/.test(value)) {',
        '        return BigInt(value.slice(0, -1));',
        '    }',
        '    return value;',
        '};',
        '',
        'export function createSdkFetch(options: SdkOptions): SdkFetch {',
        '    const getRequestId = options.requestIdFactory ?? (() => crypto.randomUUID());',
        '    return async (url: string, init: RequestInit, security?: SecurityContext): Promise<Response> => {',
        '        const baseHeaders = typeof options.headers === \'function\'',
        '            ? await options.headers()',
        '            : options.headers ?? {};',
        '        const securityHeaders = security && options.securityHandler',
        '            ? await options.securityHandler(security)',
        '            : {};',
        '        const res = await fetch(`${options.baseUrl}${url}`, {',
        '            ...init,',
        '            headers: { ...baseHeaders, ...securityHeaders, \'X-Request-ID\': getRequestId(), ...init.headers as Record<string, string> },',
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
