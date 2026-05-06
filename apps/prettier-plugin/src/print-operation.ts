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
} from '@contractkit/core';
import { SECURITY_NONE } from '@contractkit/core';
import { printType, formatDefault } from './print-type.js';
import { INDENT } from './indent.js';

const I1 = INDENT;
const I2 = INDENT.repeat(2);
const I3 = INDENT.repeat(3);
const I4 = INDENT.repeat(4);

// ─── Orphan comment helpers ──────────────────────────────────────────────────

type CommentEntry = { line: number; text: string };
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

export function printRoute(route: OpRouteNode, blocks: CommentBlock[], idx: { value: number }, nextRouteStart: number): string {
    const lines: string[] = [];
    const commentSuffix = route.description ? ` # ${route.description}` : '';
    lines.push(`${route.path}: {${commentSuffix}`);

    if (route.params !== undefined) {
        lines.push(...printParamsBlock(route.params, I1, route.paramsMode));
    }

    if (route.security !== undefined) {
        lines.push(...printSecurity(route.security, I1, I2));
    }

    for (const op of route.operations) {
        // Flush comment blocks that appear before this operation (inside the route)
        flushBlocks(lines, blocks, idx, op.loc.line, I1);
        lines.push(...printOperation(op));
    }

    // Flush comment blocks between last operation and the next route
    flushBlocks(lines, blocks, idx, nextRouteStart, I1);

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

function printOperation(op: OpOperationNode): string[] {
    const lines: string[] = [];
    const commentSuffix = op.description ? ` # ${op.description}` : '';
    const modPart = op.modifiers?.length ? `(${op.modifiers[0]})` : '';
    lines.push(`${I1}${op.method}${modPart}: {${commentSuffix}`);

    if (op.name) lines.push(`${I2}name: ${op.name}`);
    if (op.service) lines.push(`${I2}service: ${op.service}`);
    if (op.sdk) lines.push(`${I2}sdk: ${op.sdk}`);
    if (op.signature) {
        const comment = op.signatureDescription ? ` # ${op.signatureDescription}` : '';
        lines.push(`${I2}signature: ${formatSignatureValue(op.signature)}${comment}`);
    }
    if (op.security !== undefined) lines.push(...printSecurity(op.security));
    if (op.plugins && Object.keys(op.plugins).length > 0) {
        lines.push(`${I2}plugins: {`);
        for (const [key, val] of Object.entries(op.plugins)) {
            lines.push(...printPluginEntry(key, val, I3));
        }
        lines.push(`${I2}}`);
    }
    if (op.query !== undefined) lines.push(...printQueryOrHeaders('query', op.query, op.queryMode));
    if (op.requestHeadersOptOut) {
        lines.push(`${I2}headers: none`);
    } else if (op.headers !== undefined) {
        lines.push(...printQueryOrHeaders('headers', op.headers, op.headersMode));
    }
    if (op.request) {
        lines.push(`${I2}request: {`);
        for (const body of op.request.bodies) {
            lines.push(...printContentTypeLine(body.contentType, body.bodyType, I3));
        }
        lines.push(`${I2}}`);
    }
    if (op.responses.length > 0) {
        lines.push(...printResponseBlock(op.responses));
    }

    lines.push(`${I1}}`);
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

// indent: indentation for the `security` keyword line
// innerIndent: indentation for field lines inside the block
export function printSecurity(security: SecurityNode, indent = I2, innerIndent = I3): string[] {
    if (security === SECURITY_NONE) return [`${indent}security: none`];
    const fields = security as SecurityFields;
    const hasRoles = fields.roles && fields.roles.length > 0;
    if (!hasRoles) return [];
    const lines = [`${indent}security: {`];
    const comment = fields.rolesDescription ? ` # ${fields.rolesDescription}` : '';
    lines.push(`${innerIndent}roles: ${fields.roles!.join(' ')}${comment}`);
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
        const hasBody = resp.contentType && resp.bodyType;
        const hasHeaders = resp.headers && resp.headers.length > 0;
        const optOut = resp.headersOptOut;
        if (hasBody || hasHeaders || optOut) {
            lines.push(`${I3}${resp.statusCode}: {`);
            if (hasBody) {
                lines.push(...printContentTypeLine(resp.contentType!, resp.bodyType!, I4));
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
            lines.push(`${I3}${resp.statusCode}:`);
        }
    }

    lines.push(`${I2}}`);
    return lines;
}
