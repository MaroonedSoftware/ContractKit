import type {
    OpRouteNode,
    OpOperationNode,
    OpResponseNode,
    ParamSource,
    SecurityNode,
    SecurityFields,
    ContractTypeNode,
    ObjectMode,
    PluginValue,
    McpConfigNode,
    OpBodyKey,
} from '@contractkit/core';
import { SECURITY_NONE, responseBodies } from '@contractkit/core';
import { printType, formatDefault } from './print-type.js';
import { INDENT } from './indent.js';

const I1 = INDENT;
const I2 = INDENT.repeat(2);
const I3 = INDENT.repeat(3);
const I4 = INDENT.repeat(4);

// ─── Orphan comment helpers ──────────────────────────────────────────────────

type CommentEntry = { line: number; text: string };
/** A run of consecutive-line orphan comments, keyed by the source line it starts on. */
export type CommentBlock = { startLine: number; lines: string[] };

/** Group sorted orphan comment entries into consecutive-line blocks. */
export function groupComments(entries: CommentEntry[]): CommentBlock[] {
    const blocks: CommentBlock[] = [];
    let current: CommentBlock | null = null;
    for (const { line, text } of entries) {
        if (current && line === current.startLine + current.lines.length) {
            current.lines.push(text);
        } else {
            if (current) blocks.push(current);
            current = { startLine: line, lines: [text] };
        }
    }
    if (current) blocks.push(current);
    return blocks;
}

/**
 * Emit any comment blocks whose startLine is < beforeLine.
 * Lines are emitted verbatim — they already carry their original indentation.
 */
export function flushBlocks(out: string[], blocks: CommentBlock[], idx: { value: number }, beforeLine: number, _indent = '') {
    while (idx.value < blocks.length && blocks[idx.value]!.startLine < beforeLine) {
        for (const l of blocks[idx.value]!.lines) out.push(l);
        idx.value++;
    }
}

// ─── Route ───────────────────────────────────────────────────────────────────

/**
 * Render an `operation` route body from its `path: {` onward (the `operation` keyword, any
 * modifier, and the route's leading comments are prepended by the caller). Emits the
 * params/security blocks and each HTTP operation, interleaving orphan comment `blocks` at their
 * original source positions — `idx` tracks how far through `blocks` we've consumed, and
 * `nextRouteStart` bounds the flush to comments before the following route. Any
 * `route.trailingComments` (comments after the last operation, before `}`) are emitted before
 * the closing brace so they round-trip.
 *
 * Blank lines between operations come from each operation's `blankLineBefore`, so the author's
 * spacing survives rather than being normalized to one rule or the other.
 */
export function printRoute(route: OpRouteNode, blocks: CommentBlock[], idx: { value: number }, nextRouteStart: number): string {
    const lines: string[] = [];
    lines.push(`${route.path}: {`);

    if (route.params !== undefined) {
        lines.push(...printParamsBlock(route.params, I1, route.paramsMode));
    }

    if (route.security !== undefined) {
        lines.push(...printSecurity(route.security, I1, I2));
    }

    for (const op of route.operations) {
        // Reproduce the author's spacing rather than imposing our own.
        if (op.blankLineBefore && lines.length > 1) lines.push('');
        // Flush comment blocks that appear before this operation (inside the route)
        flushBlocks(lines, blocks, idx, op.loc.line, I1);
        lines.push(...printOperation(op));
    }

    // Flush comment blocks between last operation and the next route
    flushBlocks(lines, blocks, idx, nextRouteStart, I1);

    // Trailing/orphan comments after the last operation, before the closing brace.
    for (const comment of route.trailingComments ?? []) {
        lines.push(`${I1}# ${comment}`);
    }

    lines.push('}');
    return lines.join('\n');
}

// ─── Params block ────────────────────────────────────────────────────────────

function printParamsBlock(source: ParamSource, indent: string, mode?: ObjectMode): string[] {
    const prefix = mode ? `mode(${mode}) ` : '';
    if (source.kind === 'ref') {
        return [`${indent}${prefix}params: ${source.name}`];
    }
    if (source.kind === 'params') {
        const lines: string[] = [`${indent}${prefix}params: {`];
        const inner = indent + INDENT;
        for (const p of source.nodes) {
            const opt = p.optional ? '?' : '';
            let t = printType(p.type);
            if (p.nullable) t += ' | null';
            const def = p.default !== undefined ? ` = ${formatDefault(p.default)}` : '';
            const comment = p.description ? ` # ${p.description}` : '';
            lines.push(`${inner}${p.name}${opt}: ${t}${def}${comment}`);
        }
        lines.push(`${indent}}`);
        return lines;
    }
    // ContractTypeNode
    return [`${indent}${prefix}params: ${printType(source.node)}`];
}

// ─── HTTP operation ──────────────────────────────────────────────────────────

/** Order the body keys are emitted in when the node carries no source order (built programmatically). */
const CANONICAL_KEY_ORDER: OpBodyKey[] = ['name', 'service', 'sdk', 'mcp', 'signature', 'security', 'plugins', 'query', 'headers', 'request', 'responses'];

/** Render a single operation-body key. Returns `[]` when the operation doesn't carry that key. */
function printOperationKey(op: OpOperationNode, key: OpBodyKey): string[] {
    switch (key) {
        case 'name':
            return op.name ? [`${I2}name: ${op.name}`] : [];
        case 'service':
            return op.service ? [`${I2}service: ${op.service}`] : [];
        case 'sdk':
            return op.sdk ? [`${I2}sdk: ${op.sdk}`] : [];
        case 'mcp':
            if (op.mcp === true) return [`${I2}mcp: true`];
            if (op.mcp === false) return [`${I2}mcp: false`];
            return op.mcp ? printMcpBlock(op.mcp) : [];
        case 'signature': {
            if (!op.signature) return [];
            const comment = op.signatureDescription ? ` # ${op.signatureDescription}` : '';
            if (op.signaturePolicy) {
                return [
                    `${I2}signature: {`,
                    `${I3}options: ${formatSignatureValue(op.signature)}${comment}`,
                    `${I3}policy: ${op.signaturePolicy}`,
                    `${I2}}`,
                ];
            }
            return [`${I2}signature: ${formatSignatureValue(op.signature)}${comment}`];
        }
        case 'security':
            return op.security !== undefined ? printSecurity(op.security) : [];
        case 'plugins': {
            if (!op.plugins || Object.keys(op.plugins).length === 0) return [];
            const lines = [`${I2}plugins: {`];
            for (const [k, val] of Object.entries(op.plugins)) lines.push(...printPluginEntry(k, val, I3));
            lines.push(`${I2}}`);
            return lines;
        }
        case 'query':
            return op.query !== undefined ? printQueryOrHeaders('query', op.query, op.queryMode) : [];
        case 'headers':
            if (op.requestHeadersOptOut) return [`${I2}headers: none`];
            return op.headers !== undefined ? printQueryOrHeaders('headers', op.headers, op.headersMode) : [];
        case 'request': {
            if (!op.request) return [];
            const lines = [`${I2}request: {`];
            for (const body of op.request.bodies) lines.push(...printContentTypeLine(body.contentType, body.bodyType, I3));
            lines.push(`${I2}}`);
            return lines;
        }
        case 'responses':
            return op.responses.length > 0 ? printResponseBlock(op.responses) : [];
    }
}

function printOperation(op: OpOperationNode): string[] {
    const lines: string[] = [];
    const modPart = op.modifiers?.length ? `(${op.modifiers[0]})` : '';

    // A doc comment written above the method line goes back above it; only an inline one is
    // re-emitted as a trailing `#` on the header. Nodes built programmatically carry no placement,
    // and default to inline — the form most `.ck` sources use and one that round-trips as written.
    const inlineDescription = op.descriptionInline ?? true;
    if (op.description && !inlineDescription) {
        for (const line of op.description.split('\n')) lines.push(`${I1}# ${line}`);
    }
    const commentSuffix = op.description && inlineDescription ? ` # ${op.description}` : '';
    lines.push(`${I1}${op.method}${modPart}: {${commentSuffix}`);

    // Emit in source order when the parser recorded it, so formatting never reorders a user's keys.
    // Any key the source order doesn't mention (e.g. added by a later AST pass) follows in canonical order.
    const order = op.keyOrder ?? [];
    const rest = CANONICAL_KEY_ORDER.filter(k => !order.includes(k));
    for (const key of [...order, ...rest]) {
        lines.push(...printOperationKey(op, key));
    }

    lines.push(`${I1}}`);
    return lines;
}

// ─── MCP block ───────────────────────────────────────────────────────────────

/**
 * Reconstruct the `hint:` token list from the four annotation booleans, in canonical
 * order. Each set boolean contributes its positive or negative token; unset hints are omitted.
 */
function mcpHintTokens(mcp: McpConfigNode): string[] {
    const tokens: string[] = [];
    if (mcp.readOnlyHint !== undefined) tokens.push(mcp.readOnlyHint ? 'readOnly' : 'nonReadOnly');
    if (mcp.idempotentHint !== undefined) tokens.push(mcp.idempotentHint ? 'idempotent' : 'nonIdempotent');
    if (mcp.destructiveHint !== undefined) tokens.push(mcp.destructiveHint ? 'destructive' : 'nonDestructive');
    if (mcp.openWorldHint !== undefined) tokens.push(mcp.openWorldHint ? 'openWorld' : 'closedWorld');
    return tokens;
}

/** Print an `mcp: { ... }` settings block. Fields are emitted in canonical order; `hint:` is omitted when no hints are set. */
function printMcpBlock(mcp: McpConfigNode): string[] {
    const lines: string[] = [`${I2}mcp: {`];
    if (mcp.name !== undefined) lines.push(`${I3}name: "${escapeString(mcp.name)}"`);
    if (mcp.title !== undefined) lines.push(`${I3}title: "${escapeString(mcp.title)}"`);
    if (mcp.description !== undefined) lines.push(`${I3}description: "${escapeString(mcp.description)}"`);
    const tokens = mcpHintTokens(mcp);
    if (tokens.length > 0) lines.push(`${I3}hint: ${tokens.join(', ')}`);
    lines.push(`${I2}}`);
    return lines;
}

// ─── Plugins block ───────────────────────────────────────────────────────────

const IDENT_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;

function escapeString(s: string): string {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function printPluginEntry(key: string, value: PluginValue, indent: string): string[] {
    const lines: string[] = [];
    const inline = printPluginInline(value);
    if (inline !== null) {
        lines.push(`${indent}${key}: ${inline}`);
    } else {
        const head = `${indent}${key}: `;
        const block = printPluginBlock(value, indent);
        lines.push(`${head}${block[0]!.trimStart()}`);
        for (let i = 1; i < block.length; i++) lines.push(block[i]!);
    }
    return lines;
}

function printPluginInline(value: PluginValue): string | null {
    if (typeof value === 'string') return `"${escapeString(value)}"`;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value === null) return 'null';
    if (Array.isArray(value) && value.length === 0) return '[]';
    if (!Array.isArray(value) && typeof value === 'object' && Object.keys(value).length === 0) return '{}';
    return null;
}

function printPluginBlock(value: PluginValue, indent: string): string[] {
    const inner = indent + INDENT;
    const lines: string[] = [];
    if (Array.isArray(value)) {
        lines.push(`${indent}[`);
        for (const item of value) {
            const inline = printPluginInline(item);
            if (inline !== null) {
                lines.push(`${inner}${inline}`);
            } else {
                const block = printPluginBlock(item, inner);
                for (const l of block) lines.push(l);
            }
        }
        lines.push(`${indent}]`);
        return lines;
    }
    if (typeof value === 'object' && value !== null) {
        lines.push(`${indent}{`);
        for (const [k, v] of Object.entries(value)) {
            const fieldKey = IDENT_RE.test(k) ? k : `"${escapeString(k)}"`;
            const inline = printPluginInline(v);
            if (inline !== null) {
                lines.push(`${inner}${fieldKey}: ${inline}`);
            } else {
                const block = printPluginBlock(v, inner);
                lines.push(`${inner}${fieldKey}: ${block[0]!.trimStart()}`);
                for (let i = 1; i < block.length; i++) lines.push(block[i]!);
            }
        }
        lines.push(`${indent}}`);
        return lines;
    }
    // Scalars are always inline; printPluginInline already handles them.
    return [`${indent}${printPluginInline(value)}`];
}

// ─── Security ────────────────────────────────────────────────────────────────

/** Print a signature key: unquoted when it's a plain identifier, quoted otherwise. */
function formatSignatureValue(value: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value) ? value : `"${value}"`;
}

/**
 * Print a `security:` declaration. Returns `["${indent}security: none"]` for the public-endpoint
 * sentinel, a multi-line block when `policy` is set, or an empty array when there's nothing
 * meaningful to emit.
 *
 * @param indent indentation for the `security` keyword line
 * @param innerIndent indentation for field lines inside the block
 */
export function printSecurity(security: SecurityNode, indent = I2, innerIndent = I3): string[] {
    if (security === SECURITY_NONE) return [`${indent}security: none`];
    const fields = security as SecurityFields;
    if (fields.policy === undefined) return [];
    const lines = [`${indent}security: {`];
    const comment = fields.policyDescription ? ` # ${fields.policyDescription}` : '';
    const value = fields.policy === false ? 'none' : fields.policy;
    lines.push(`${innerIndent}policy: ${value}${comment}`);
    lines.push(`${indent}}`);
    return lines;
}

// ─── Query / headers ─────────────────────────────────────────────────────────

function printQueryOrHeaders(keyword: 'query' | 'headers', source: ParamSource, mode?: ObjectMode): string[] {
    const prefix = mode ? `mode(${mode}) ` : '';
    if (source.kind === 'ref') {
        return [`${I2}${prefix}${keyword}: ${source.name}`];
    }
    if (source.kind === 'params') {
        if (source.nodes.length === 0) return [];
        const lines: string[] = [`${I2}${prefix}${keyword}: {`];
        for (const p of source.nodes) {
            const opt = p.optional ? '?' : '';
            let t = printType(p.type);
            if (p.nullable) t += ' | null';
            const def = p.default !== undefined ? ` = ${formatDefault(p.default)}` : '';
            const comment = p.description ? ` # ${p.description}` : '';
            lines.push(`${I3}${p.name}${opt}: ${t}${def}${comment}`);
        }
        lines.push(`${I2}}`);
        return lines;
    }
    // ContractTypeNode (e.g. intersection)
    return [`${I2}${prefix}${keyword}: ${printType(source.node)}`];
}

// ─── Content-type line ───────────────────────────────────────────────────────

/** Print a `contentType: bodyType` line, expanding inline brace objects onto separate lines. */
function printContentTypeLine(contentType: string, bodyType: ContractTypeNode, lineIndent: string): string[] {
    if (bodyType.kind === 'inlineObject') {
        const fieldIndent = lineIndent + INDENT;
        const lines: string[] = [`${lineIndent}${contentType}: {`];
        for (const f of bodyType.fields) {
            const opt = f.optional ? '?' : '';
            let t = printType(f.type);
            if (f.nullable) t += ' | null';
            const def = f.default !== undefined ? ` = ${formatDefault(f.default)}` : '';
            const comment = f.description ? ` # ${f.description}` : '';
            lines.push(`${fieldIndent}${f.name}${opt}: ${t}${def}${comment}`);
        }
        lines.push(`${lineIndent}}`);
        return lines;
    }
    return [`${lineIndent}${contentType}: ${printType(bodyType)}`];
}

// ─── Response block ──────────────────────────────────────────────────────────

function printResponseBlock(responses: OpResponseNode[]): string[] {
    const lines: string[] = [`${I2}response: {`];

    for (const resp of responses) {
        const bodies = responseBodies(resp);
        const hasHeaders = resp.headers && resp.headers.length > 0;
        const optOut = resp.headersOptOut;
        const onlyBody = bodies.length === 1 ? bodies[0]! : undefined;
        // `404(documented):` — the modifier changes what codegen does, so it has to survive.
        const code = resp.emit ? `${resp.statusCode}(${resp.emit})` : `${resp.statusCode}`;
        if (resp.inline && onlyBody && !hasHeaders && !optOut && onlyBody.bodyType.kind !== 'inlineObject') {
            // Written on one line in the source, so keep it there: `200: { application/json: Pet }`.
            lines.push(`${I3}${code}: { ${onlyBody.contentType}: ${printType(onlyBody.bodyType)} }`);
        } else if (bodies.length === 0 && !hasHeaders && !optOut && resp.hasBlock) {
            // An empty block means "emitted, no body" — collapsing it to `304:` would change
            // the generated router, so it is not a formatting detail.
            lines.push(`${I3}${code}: {}`);
        } else if (bodies.length > 0 || hasHeaders || optOut) {
            lines.push(`${I3}${code}: {`);
            for (const body of bodies) {
                lines.push(...printContentTypeLine(body.contentType, body.bodyType, I4));
            }
            if (optOut) {
                lines.push(`${I4}headers: none`);
            } else if (hasHeaders) {
                lines.push(`${I4}headers: {`);
                for (const h of resp.headers!) {
                    const opt = h.optional ? '?' : '';
                    const trail = h.description ? ` # ${h.description}` : '';
                    lines.push(`${I4}${INDENT}${h.name}${opt}: ${printType(h.type)}${trail}`);
                }
                lines.push(`${I4}}`);
            }
            lines.push(`${I3}}`);
        } else {
            lines.push(`${I3}${code}:`);
        }
    }

    lines.push(`${I2}}`);
    return lines;
}
