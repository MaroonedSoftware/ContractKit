import type { OpRootNode, OpRouteNode, OpOperationNode, McpConfigNode, ParamSource, ContractTypeNode, SecurityNode } from '@contractkit/core';
import { resolveModifiers, resolveSecurity, SECURITY_NONE, emittedResponses, toIdentifier } from '@contractkit/core';
import { renderType, renderInputType, pascalToDotCase } from './codegen-contract.js';
import { inferService, deriveModulePath, buildArgs, deriveBaseName } from './codegen-operation.js';
import { quoteKey, escapeSingleQuoted, sourceLink } from './ts-render.js';
import { DECIMAL_IMPORT, DECIMAL_PRELUDE_LINES } from './decimal-runtime.js';
import { basename, dirname, relative } from 'node:path';
import type { RouteMiddleware, ServerFramework } from './server-framework.js';
import { KOA_SERVER_FRAMEWORK } from './server-framework-koa.js';
import { policyGuard } from './route-guards.js';

/**
 * Source location for a `SecurityNode` this generator builds rather than reads off a `.ck` file.
 * Nothing on the MCP path reports a location for one, but `SecurityFields` requires it.
 */
const SYNTHETIC_LOC = { file: '', line: 0 } as const;

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
                // The handler destructures these, so the key has to be a valid identifier. The MCP
                // input schema is ours to name — nothing on an HTTP wire depends on it.
                props.push({ key: toIdentifier(node.name), expr: renderInputType(node.type, modelsWithInput), optional: false });
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
    /** Effective security for the operation, cascaded operation → route → file. */
    security: SecurityNode | undefined;
}

export function planTools(root: OpRootNode, includeInternal: boolean): ToolPlan[] {
    const plans: ToolPlan[] = [];
    for (const route of root.routes) {
        for (const op of route.operations) {
            if (!op.mcp) continue;
            if (!includeInternal && resolveModifiers(route, op).includes('internal')) continue;
            const toolName = deriveToolName(op, route);
            const className = deriveToolClassName(toolName);
            plans.push({
                route,
                op,
                toolName,
                className,
                argsConstName: `${toPascal(toolName)}Args`,
                security: resolveSecurity(route, op, root),
            });
        }
    }
    return plans;
}

/**
 * The `requireMcpPolicy` call a tool handler opens with, or undefined when the operation is
 * declared `security: none` and the tool is deliberately public.
 *
 * The guard on `POST /mcp` closes the mount, not the tools behind it: one `tools/call` reaches every
 * registered tool. So a tool enforces its operation's own declaration, the same one its HTTP route
 * carries — a tool is another way to invoke the operation, not a way around its security.
 *
 * An operation that declares nothing takes {@link MFA_SATISFIED_POLICY}, which is exactly what
 * `requirePolicy()` applies to its HTTP route. Note this is *not* `requireMcpPolicy`'s own default
 * of session-only: a caller holding ServerKit's static MCP token carries no factors and fails the
 * MFA gate, and the fix for that is an app-level policy override recognising `claims.mcp`, not a
 * generated floor lower than the contract's.
 */
function toolPolicyCheck(security: SecurityNode | undefined): string | undefined {
    if (security === SECURITY_NONE) return undefined;

    const policy = security?.policy;
    if (policy === undefined) return `await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });`;
    // `false` is a declaration: validate the session, apply no policy.
    if (policy === false) return `await requireMcpPolicy(context, this.policies);`;

    return `await requireMcpPolicy(context, this.policies, { policy: '${escapeSingleQuoted(policy)}' });`;
}

function renderToolClass(plan: ToolPlan, file: string, options: McpCodegenOptions): string[] {
    const { route, op, toolName, className, argsConstName } = plan;
    const cfg = mcpConfig(op);
    const lines: string[] = [];

    // JSDoc source link
    lines.push('/**');
    lines.push(` * from ${sourceLink(basename(file), options.outPath, file, op.loc.line)}`);
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

    // constructor injects the operation's service, plus the PolicyService when the tool has a
    // security check to run — a tool declared `security: none` needs neither.
    const service = inferService(op, route, file);
    const policyCheck = toolPolicyCheck(plan.security);
    const ctorParams = [`private readonly service: ${service.className}`];
    if (policyCheck) ctorParams.push('private readonly policies: PolicyService');
    lines.push(`    constructor(${ctorParams.join(', ')}) {}`);
    lines.push('');

    // handle
    const props = buildArgsProps(route, op, options.modelsWithInput);
    const destructure = props.map(p => p.key);
    const callArgs = buildArgs(route, op);
    const isVoid = !primaryResponseBody(op);
    const structured = !!outExpr;

    // No args to destructure means the parameter goes unread, which trips no-unused-vars in
    // consumers that lint generated output; the leading underscore opts it out.
    const argsParam = destructure.length > 0 ? 'args' : '_args';
    // Same reasoning for the context parameter: only a tool that runs a security check reads it.
    const contextParam = policyCheck ? 'context' : '_context';
    lines.push(`    async handle(${argsParam}: Record<string, unknown>, ${contextParam}: McpToolContext): Promise<CallToolResult> {`);
    // Before the arguments are even parsed: an unauthorized caller learns nothing about the schema.
    if (policyCheck) lines.push(`        ${policyCheck}`);
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

    // The mcp import turns into a mixed value/type one as soon as a tool guards itself, and the
    // policy imports follow the same rule: nothing a file does not reference reaches its imports.
    const guardsItself = /\brequireMcpPolicy\b/.test(bodyWithHelpers);
    const mcpTypes = `type McpToolHandler, type McpToolHandlerMap, type McpToolContext`;
    imports.push(
        guardsItself
            ? `import { requireMcpPolicy, ${mcpTypes} } from '@maroonedsoftware/mcp';`
            : `import type { McpToolHandler, McpToolHandlerMap, McpToolContext } from '@maroonedsoftware/mcp';`,
    );
    if (guardsItself) imports.push(`import { PolicyService } from '@maroonedsoftware/policies';`);
    if (/\bMFA_SATISFIED_POLICY\b/.test(bodyWithHelpers)) imports.push(`import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';`);
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

    const header = `// Auto-generated MCP tools\n// generated from ${sourceLink(basename(root.file), options.outPath, root.file)}`;

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
    lines.push('/**');
    lines.push(' * Build the MCP tool catalog.');
    lines.push(' *');
    lines.push(' * Bind it to the `McpToolHandlerMap` token from a factory, which is what supplies the');
    lines.push(' * `Container` needed to resolve each handler:');
    lines.push(' *');
    lines.push(' * ```ts');
    lines.push(' * registry.register(McpToolHandlerMap).useFactory(registerMcpTools).asSingleton();');
    lines.push(' * ```');
    lines.push(' */');
    lines.push('export function registerMcpTools(container: Container): McpToolHandlerMap {');
    lines.push('    const map = new McpToolHandlerMap();');
    for (const e of sorted) lines.push(`    ${e.registerFn}(map, container);`);
    lines.push('    return map;');
    lines.push('}');
    return lines.join('\n') + '\n';
}

/**
 * Generate the optional `mcp.router.ts` — the standard ServerKit route wiring for the dispatcher.
 *
 * The whole file is framework-specific boilerplate rather than a per-operation render, so the
 * adapter owns the template. Defaults to Koa, matching the router generator.
 */
export function generateMcpRouter(options: { path?: string; framework?: ServerFramework; security?: SecurityNode } = {}): string {
    const framework = options.framework ?? KOA_SERVER_FRAMEWORK;
    const guards: RouteMiddleware = { bodyContentTypes: ['application/json'] };

    // Defaults to a session check with no policy, matching `defaultMcpMountSecurity` for a config
    // that names none. The tools behind the mount enforce their own declarations either way.
    const policy = policyGuard(framework, options.security ?? { policy: false, loc: SYNTHETIC_LOC });
    if (policy) guards.policy = policy;

    return framework.mcpRouter({ path: options.path ?? '/mcp', guards });
}

/**
 * The mount guard for a config that names no `mcp.security`: open when any exposed tool is declared
 * `security: none`, and a bare session check otherwise.
 *
 * One route serves every tool, so the mount can be no stricter than the most permissive tool behind
 * it without locking that tool out. It is still never weaker than the contracts, because each
 * handler asserts its own policy — the mount only decides whether an unauthenticated caller is
 * turned away at the door or inside the tool.
 */
export function defaultMcpMountSecurity(roots: readonly OpRootNode[], includeInternal: boolean): SecurityNode {
    for (const root of roots) {
        for (const plan of planTools(root, includeInternal)) {
            if (plan.security === SECURITY_NONE) return SECURITY_NONE;
        }
    }
    return { policy: false, loc: SYNTHETIC_LOC };
}
