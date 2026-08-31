import type { OpRootNode, OpRouteNode, OpOperationNode, McpConfigNode, ParamSource, ContractTypeNode } from '@contractkit/core';
import { resolveModifiers, emittedResponses } from '@contractkit/core';
import { renderType, renderInputType, pascalToDotCase } from './codegen-contract.js';
import { inferService, deriveModulePath, buildArgs, deriveBaseName } from './codegen-operation.js';
import { quoteKey, escapeSingleQuoted } from './ts-render.js';
import { DECIMAL_IMPORT, DECIMAL_PRELUDE_LINES } from './decimal-runtime.js';
import { basename, dirname, relative } from 'node:path';

// ─── Options ────────────────────────────────────────────────────────────────

export interface McpCodegenOptions {
    /** Absolute path of the file being generated. Used to compute relative imports. */
    outPath?: string;
    /** Map from schema identifier (model name / `${name}Input`) → absolute output file. */
    modelOutPaths?: Map<string, string>;
    /** Model names that have an Input variant schema. */
    modelsWithInput?: Set<string>;
    /** Model names that have an Output variant schema. */
    modelsWithOutput?: Set<string>;
    /** Import-path template for service implementations (same semantics as ServerConfig). */
    servicePathTemplate?: string;
    /** Emit tools for `internal` operations. Default false. */
    includeInternal?: boolean;
}

// ─── MCP flag helpers ─────────────────────────────────────────────────────

/** The explicit settings block, if the operation used the object form of `mcp:`. */
function mcpConfig(op: OpOperationNode): McpConfigNode | undefined {
    return op.mcp && typeof op.mcp === 'object' ? op.mcp : undefined;
}

/**
 * True if the root has at least one MCP-exposed operation. With `includeInternal: false`
 * (default) `internal` operations don't count. Mirrors `hasPublicOperations`.
 */
export function hasMcpOperations(root: OpRootNode, includeInternal = false): boolean {
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!op.mcp) continue;
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            return true;
        }
    }
    return false;
}

// ─── Name derivation ────────────────────────────────────────────────────────

/** camelCase / PascalCase / spaced / hyphenated → snake_case. */
function toSnake(s: string): string {
    return s
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s\-.]+/g, '_')
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/** snake_case → PascalCase. */
function toPascal(s: string): string {
    return s
        .split('_')
        .filter(Boolean)
        .map(p => p.charAt(0).toUpperCase() + p.slice(1))
        .join('');
}

/** Inferred snake_case tool name from method + path, e.g. GET /payments/{id} → get_payments_by_id. */
function inferToolName(method: string, path: string): string {
    const parts: string[] = [method.toLowerCase()];
    for (const seg of path.split('/').filter(Boolean)) {
        if (seg.startsWith('{')) {
            parts.push('by', toSnake(seg.slice(1, -1)));
        } else {
            parts.push(toSnake(seg));
        }
    }
    return parts.filter(Boolean).join('_');
}

/** Tool name: explicit `mcp.name` (verbatim) → `sdk` → `name` → inferred; derived forms snake_cased. */
function deriveToolName(op: OpOperationNode, route: OpRouteNode): string {
    const cfg = mcpConfig(op);
    if (cfg?.name) return cfg.name;
    if (op.sdk) return toSnake(op.sdk);
    if (op.name) return toSnake(op.name);
    return inferToolName(op.method, route.path);
}

/** Tool class name — PascalCase of the tool name with an `McpTool` suffix for clarity. */
function deriveToolClassName(toolName: string): string {
    return `${toPascal(toolName)}McpTool`;
}

// ─── Input args schema ────────────────────────────────────────────────────

interface ArgsProp {
    key: string;
    expr: string;
    optional: boolean;
}

/** Build the flat args properties for a tool, matching the router's `buildArgs` variable names. */
function buildArgsProps(route: OpRouteNode, op: OpOperationNode, modelsWithInput?: Set<string>): ArgsProp[] {
    const props: ArgsProp[] = [];

    // Path params — spread individually (inline) or as a single `params` object (ref/type).
    if (route.params) {
        if (route.params.kind === 'params') {
            for (const node of route.params.nodes) {
                props.push({ key: node.name, expr: renderInputType(node.type, modelsWithInput), optional: false });
            }
        } else if (route.params.kind === 'ref') {
            props.push({ key: 'params', expr: refSchema(route.params.name, modelsWithInput), optional: false });
        } else {
            props.push({ key: 'params', expr: renderInputType(route.params.node, modelsWithInput), optional: false });
        }
    }

    // Body — single JSON body maps to a `body` field; multipart/binary/multi bodies aren't cleanly
    // representable as JSON tool args, so they fall back to `z.unknown()` (advisory only).
    const bodies = op.request?.bodies ?? [];
    if (bodies.length === 1 && bodies[0]!.contentType === 'multipart/form-data') {
        props.push({ key: 'multipartBody', expr: 'z.unknown()', optional: false });
    } else if (bodies.length === 1) {
        props.push({ key: 'body', expr: renderInputType(bodies[0]!.bodyType, modelsWithInput), optional: false });
    } else if (bodies.length > 1) {
        props.push({ key: 'body', expr: 'z.unknown()', optional: false });
    }

    // Query / headers — whole objects, optional.
    if (op.query) props.push({ key: 'query', expr: paramSourceSchema(op.query, modelsWithInput), optional: true });
    if (op.headers) props.push({ key: 'headers', expr: paramSourceSchema(op.headers, modelsWithInput), optional: true });

    return props;
}

function refSchema(name: string, modelsWithInput?: Set<string>): string {
    return modelsWithInput?.has(name) ? `${name}Input` : name;
}

function paramSourceSchema(src: ParamSource, modelsWithInput?: Set<string>): string {
    if (src.kind === 'ref') return refSchema(src.name, modelsWithInput);
    if (src.kind === 'type') return renderInputType(src.node, modelsWithInput);
    const fields = src.nodes.map(n => `${quoteKey(n.name)}: ${renderInputType(n.type, modelsWithInput)}`).join(', ');
    return `z.object({ ${fields} })`;
}

function argsSchemaExpr(props: ArgsProp[]): string {
    if (props.length === 0) return 'z.object({})';
    const fields = props.map(p => `${quoteKey(p.key)}: ${p.expr}${p.optional ? '.optional()' : ''}`).join(', ');
    return `z.object({ ${fields} })`;
}

// ─── Output schema ──────────────────────────────────────────────────────────

/**
 * The body an MCP tool reports as its output: the first body the service can actually return.
 *
 * Documented and thrown statuses are skipped — an MCP tool describes what a successful call
 * produces, not what the operation is allowed to document.
 */
function primaryResponseBody(op: OpOperationNode): ContractTypeNode | undefined {
    for (const resp of emittedResponses(op)) {
        if (resp.bodies[0]) return resp.bodies[0].bodyType;
    }
    return undefined;
}

/** MCP output schemas must be objects — only model refs and inline objects qualify. */
function outputSchemaExpr(op: OpOperationNode): string | undefined {
    const body = primaryResponseBody(op);
    if (!body) return undefined;
    if (body.kind === 'ref') return body.name;
    if (body.kind === 'inlineObject') return renderType(body);
    return undefined;
}

// ─── Annotations ────────────────────────────────────────────────────────────

const HINT_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

function annotationsExpr(cfg: McpConfigNode | undefined): string | undefined {
    if (!cfg) return undefined;
    const parts: string[] = [];
    for (const key of HINT_KEYS) {
        const val = cfg[key];
        if (val !== undefined) parts.push(`${key}: ${val}`);
    }
    return parts.length > 0 ? `{ ${parts.join(', ')} }` : undefined;
}

// ─── Schema-import collection ───────────────────────────────────────────────

function walkTypeRefs(type: ContractTypeNode, ids: Set<string>, variant: 'input' | 'read', modelsWithInput?: Set<string>): void {
    switch (type.kind) {
        case 'ref':
            ids.add(variant === 'input' ? refSchema(type.name, modelsWithInput) : type.name);
            break;
        case 'array':
            walkTypeRefs(type.item, ids, variant, modelsWithInput);
            break;
        case 'tuple':
            type.items.forEach(t => walkTypeRefs(t, ids, variant, modelsWithInput));
            break;
        case 'record':
            walkTypeRefs(type.key, ids, variant, modelsWithInput);
            walkTypeRefs(type.value, ids, variant, modelsWithInput);
            break;
        case 'union':
        case 'discriminatedUnion':
        case 'intersection':
            type.members.forEach(t => walkTypeRefs(t, ids, variant, modelsWithInput));
            break;
        case 'inlineObject':
            type.fields.forEach(f => walkTypeRefs(f.type, ids, variant, modelsWithInput));
            break;
        case 'lazy':
            walkTypeRefs(type.inner, ids, variant, modelsWithInput);
            break;
    }
}

function walkSourceRefs(src: ParamSource | undefined, ids: Set<string>, modelsWithInput?: Set<string>): void {
    if (!src) return;
    if (src.kind === 'ref') ids.add(refSchema(src.name, modelsWithInput));
    else if (src.kind === 'params') src.nodes.forEach(n => walkTypeRefs(n.type, ids, 'input', modelsWithInput));
    else walkTypeRefs(src.node, ids, 'input', modelsWithInput);
}

/** Collect every schema identifier the emitted tools import (input variants + read variants for output). */
function collectSchemaIds(ops: { route: OpRouteNode; op: OpOperationNode }[], modelsWithInput?: Set<string>): Set<string> {
    const ids = new Set<string>();
    for (const { route, op } of ops) {
        walkSourceRefs(route.params, ids, modelsWithInput);
        const bodies = op.request?.bodies ?? [];
        if (bodies.length === 1 && bodies[0]!.contentType !== 'multipart/form-data') {
            walkTypeRefs(bodies[0]!.bodyType, ids, 'input', modelsWithInput);
        }
        walkSourceRefs(op.query, ids, modelsWithInput);
        walkSourceRefs(op.headers, ids, modelsWithInput);

        const body = primaryResponseBody(op);
        if (body && (body.kind === 'ref' || body.kind === 'inlineObject')) walkTypeRefs(body, ids, 'read');
    }
    return ids;
}

function schemaImportLines(ids: Set<string>, options: McpCodegenOptions): string[] {
    const lines: string[] = [];
    const { modelOutPaths, outPath } = options;
    if (ids.size === 0) return lines;
    if (modelOutPaths && outPath) {
        const byFile = new Map<string, string[]>();
        const unresolved: string[] = [];
        for (const id of ids) {
            const p = modelOutPaths.get(id);
            if (p) {
                const group = byFile.get(p) ?? [];
                group.push(id);
                byFile.set(p, group);
            } else {
                unresolved.push(id);
            }
        }
        const fromDir = dirname(outPath);
        for (const [file, names] of byFile) {
            let rel = relative(fromDir, file).replace(/\.ts$/, '.js');
            if (!rel.startsWith('.')) rel = './' + rel;
            lines.push(`import { ${names.sort().join(', ')} } from '${rel}';`);
        }
        for (const id of unresolved.sort()) lines.push(`import { ${id} } from './${pascalToDotCase(id)}.js';`);
    } else {
        for (const id of [...ids].sort()) lines.push(`import { ${id} } from './${pascalToDotCase(id)}.js';`);
    }
    return lines;
}

// ─── Zod scalar helper preludes ─────────────────────────────────────────────

function scalarHelperLines(body: string): string[] {
    const lines: string[] = [];
    if (body.includes('_ZodBinary')) {
        lines.push(`const _ZodBinary = z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' });`);
    }
    if (body.includes('_ZodDatetime')) {
        lines.push(
            `const _ZodDatetime = z.preprocess((val) => typeof val === 'string' ? DateTime.fromISO(val) : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be in ISO 8601 format' }));`,
        );
    }
    if (body.includes('_ZodDecimal')) {
        lines.push(...DECIMAL_PRELUDE_LINES);
    }
    if (body.includes('_ZodInterval')) {
        lines.push(
            `const _ZodInterval = z.preprocess((val) => typeof val === 'string' ? Interval.fromISO(val) : val, z.custom<Interval>((val) => val instanceof Interval && val.isValid, { message: 'Must be an ISO 8601 interval' })).transform(val => val.toISO()!);`,
        );
    }
    if (body.includes('_ZodJson')) {
        lines.push(`type _JsonValue = string | number | boolean | null | _JsonValue[] | { [key: string]: _JsonValue };`);
        lines.push(
            `const _ZodJson: z.ZodType<_JsonValue> = z.lazy(() => z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(_ZodJson), z.record(z.string(), _ZodJson)]));`,
        );
    }
    return lines;
}

// ─── Per-tool codegen ─────────────────────────────────────────────────────

interface ToolPlan {
    route: OpRouteNode;
    op: OpOperationNode;
    toolName: string;
    className: string;
    argsConstName: string;
}

function planTools(root: OpRootNode, includeInternal: boolean): ToolPlan[] {
    const plans: ToolPlan[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!op.mcp) continue;
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            const toolName = deriveToolName(op, route);
            const className = deriveToolClassName(toolName);
            plans.push({ route, op, toolName, className, argsConstName: `${toPascal(toolName)}Args` });
        }
    }
    return plans;
}

function renderToolClass(plan: ToolPlan, file: string, options: McpCodegenOptions): string[] {
    const { route, op, toolName, className, argsConstName } = plan;
    const cfg = mcpConfig(op);
    const lines: string[] = [];

    // JSDoc source link
    const relFile = options.outPath ? relative(dirname(options.outPath), file) : file;
    lines.push('/**');
    lines.push(` * from [${basename(file)}](file://./${relFile}#L${op.loc.line})`);
    lines.push(' */');

    lines.push('@Injectable()');
    lines.push(`export class ${className} implements McpToolHandler {`);

    // definition
    lines.push('    readonly definition: Tool = {');
    lines.push(`        name: '${escapeSingleQuoted(toolName)}',`);
    if (cfg?.title) lines.push(`        title: '${escapeSingleQuoted(cfg.title)}',`);
    const desc = cfg?.description ?? op.description ?? route.description;
    if (desc) lines.push(`        description: '${escapeSingleQuoted(desc)}',`);
    lines.push(`        inputSchema: z.toJSONSchema(${argsConstName}, { unrepresentable: 'any' }) as Tool['inputSchema'],`);
    const outExpr = outputSchemaExpr(op);
    if (outExpr) lines.push(`        outputSchema: z.toJSONSchema(${outExpr}, { unrepresentable: 'any' }) as Tool['outputSchema'],`);
    const annotations = annotationsExpr(cfg);
    if (annotations) lines.push(`        annotations: ${annotations},`);
    lines.push('    };');
    lines.push('');

    // constructor injects the operation's service
    const service = inferService(op, route, file);
    lines.push(`    constructor(private readonly service: ${service.className}) {}`);
    lines.push('');

    // handle
    const props = buildArgsProps(route, op, options.modelsWithInput);
    const destructure = props.map(p => p.key);
    const callArgs = buildArgs(route, op);
    const isVoid = !primaryResponseBody(op);
    const structured = !!outExpr;

    lines.push('    async handle(args: Record<string, unknown>, _context: McpToolContext): Promise<CallToolResult> {');
    if (destructure.length > 0) {
        lines.push(`        const { ${destructure.join(', ')} } = await parseAndValidate(args, ${argsConstName});`);
    }
    if (isVoid) {
        lines.push(`        await this.service.${service.methodName}(${callArgs});`);
        lines.push(`        return { content: [{ type: 'text', text: 'OK' }] };`);
    } else {
        lines.push(`        const result = await this.service.${service.methodName}(${callArgs});`);
        if (structured) {
            lines.push(`        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };`);
        } else {
            lines.push(`        return { content: [{ type: 'text', text: JSON.stringify(result) }] };`);
        }
    }
    lines.push('    }');
    lines.push('}');

    return lines;
}

// ─── Public entry points ────────────────────────────────────────────────────

/** The exported register-fn name for an op-root file, e.g. `payments.op` → `registerPaymentsMcpTools`. */
export function deriveMcpRegisterFnName(file: string): string {
    return `register${deriveBaseName(file)}McpTools`;
}

/** Generate one `<filename>.mcp.ts` for an op-root: tool handler classes + a per-file register fn. */
export function generateMcpFile(root: OpRootNode, options: McpCodegenOptions = {}): string {
    const includeInternal = options.includeInternal ?? false;
    const plans = planTools(root, includeInternal);

    // Args schema consts (also drive the JSON-Schema definitions).
    const argsConsts = plans.map(p => `const ${p.argsConstName} = ${argsSchemaExpr(buildArgsProps(p.route, p.op, options.modelsWithInput))};`);

    // Tool classes.
    const classes = plans.map(p => renderToolClass(p, root.file, options).join('\n'));

    // Per-file register fn.
    const registerFn: string[] = [];
    registerFn.push(`/** Add this file's tools to the shared catalog. */`);
    registerFn.push(`export function ${deriveMcpRegisterFnName(root.file)}(map: McpToolHandlerMap, container: Container): void {`);
    for (const p of plans) registerFn.push(`    map.set('${escapeSingleQuoted(p.toolName)}', container.get(${p.className}));`);
    registerFn.push('}');

    const bodyCore = [argsConsts.join('\n'), classes.join('\n\n'), registerFn.join('\n')].filter(Boolean).join('\n\n');

    // Zod scalar helper consts (must precede the args consts that reference them).
    const helperConsts = scalarHelperLines(bodyCore);
    const bodyWithHelpers = [helperConsts.join('\n'), bodyCore].filter(Boolean).join('\n\n');

    // ── Imports ──
    const needsParseAndValidate = plans.some(p => buildArgsProps(p.route, p.op, options.modelsWithInput).length > 0);
    const imports: string[] = [];
    imports.push(`import { Injectable, type Container } from 'injectkit';`);
    imports.push(`import { z } from 'zod';`);

    const luxon: string[] = [];
    if (/\bDateTime\b/.test(bodyWithHelpers)) luxon.push('DateTime');
    if (/\bInterval\b/.test(bodyWithHelpers)) luxon.push('Interval');
    if (/\bDuration\b/.test(bodyWithHelpers)) luxon.push('Duration');
    if (luxon.length > 0) imports.push(`import { ${luxon.join(', ')} } from 'luxon';`);
    if (/\bDecimal\b/.test(bodyWithHelpers)) imports.push(DECIMAL_IMPORT);

    imports.push(`import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';`);
    imports.push(`import type { McpToolHandler, McpToolHandlerMap, McpToolContext } from '@maroonedsoftware/mcp';`);
    if (needsParseAndValidate) imports.push(`import { parseAndValidate } from '@maroonedsoftware/zod';`);

    // Service imports (one per distinct service used by the emitted tools).
    const serviceModules = new Map<string, string>();
    for (const p of plans) {
        const svc = inferService(p.op, p.route, root.file).className;
        if (!serviceModules.has(svc)) {
            serviceModules.set(svc, root.services?.[svc] ?? root.meta[svc] ?? deriveModulePath(svc, options.servicePathTemplate));
        }
    }
    for (const [svc, mod] of [...serviceModules.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        imports.push(`import { ${svc} } from '${mod}';`);
    }

    // Schema imports.
    imports.push(...schemaImportLines(collectSchemaIds(plans, options.modelsWithInput), options));

    const relFile = options.outPath ? relative(dirname(options.outPath), root.file) : root.file;
    const header = `// Auto-generated MCP tools\n// generated from [${basename(root.file)}](file://./${relFile})`;

    return `${header}\n${imports.join('\n')}\n\n${bodyWithHelpers}\n`;
}

/** One entry per emitted `<filename>.mcp.ts` for the aggregator to import. */
export interface McpAggregatorEntry {
    /** The file's exported register fn name, e.g. `registerPaymentsMcpTools`. */
    registerFn: string;
    /** Module specifier for the file, relative to the aggregator and `.js`-suffixed. */
    importPath: string;
}

/** Generate the aggregator `mcp.tools.ts` that assembles the single McpToolHandlerMap. */
export function generateMcpAggregator(entries: McpAggregatorEntry[]): string {
    const sorted = [...entries].sort((a, b) => a.registerFn.localeCompare(b.registerFn));
    const lines: string[] = [];
    lines.push(`import { type Container } from 'injectkit';`);
    lines.push(`import { McpToolHandlerMap } from '@maroonedsoftware/mcp';`);
    for (const e of sorted) lines.push(`import { ${e.registerFn} } from '${e.importPath}';`);
    lines.push('');
    lines.push('/** Build + register the MCP tool catalog. Call once at startup. */');
    lines.push('export function registerMcpTools(container: Container): McpToolHandlerMap {');
    lines.push('    const map = new McpToolHandlerMap();');
    for (const e of sorted) lines.push(`    ${e.registerFn}(map, container);`);
    lines.push('    container.register(McpToolHandlerMap, { useValue: map });');
    lines.push('    return map;');
    lines.push('}');
    return lines.join('\n') + '\n';
}

/** Generate the optional `mcp.router.ts` — the standard ServerKit route wiring for the dispatcher. */
export function generateMcpRouter(options: { path?: string } = {}): string {
    const path = options.path ?? '/mcp';
    return `import { ServerKitRouter, requireSignature } from '@maroonedsoftware/koa';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** Mount the MCP endpoint onto a ServerKit router. Call \`registerMcpTools(container)\` at startup. */
export function mountMcp(router: ReturnType<typeof ServerKitRouter>): void {
    router.post('${path}', requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async (ctx) => {
        const dispatcher = ctx.container.get(McpDispatcher);
        const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger });
        if (dispatcher.sessionMode === 'stateful') {
            ctx.respond = false;
            await dispatcher.dispatchStateful(
                { req: ctx.req, res: ctx.res, body: ctx.request.body, sessionId: ctx.get('mcp-session-id') },
                context,
            );
        } else {
            const response = await dispatcher.dispatch(JSON.parse(ctx.rawBody), context);
            if (response) ctx.body = response;
        }
    });
}
`;
}
