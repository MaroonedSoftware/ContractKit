import type { CkRootNode, OpResponseHeaderNode } from '@contractkit/core';
import { printModelDecl } from './print-contract.js';
import { printRoute, printSecurity, type CommentBlock } from './print-operation.js';
import { printType } from './print-type.js';
import { INDENT } from './indent.js';

export const DEFAULT_PRINT_WIDTH = 80;

// ─── Options block ──────────────────────────────────────────────────────────

/**
 * Quote an options-block value if it isn't a plain identifier.
 *
 * Plain identifiers (starts with letter/underscore/dollar, rest are
 * alphanumeric/underscore/dollar/hyphen/dot) are left bare. Everything
 * else — paths with slashes, values starting with `#`, values with spaces,
 * etc. — is double-quoted so the round-trip parse is unambiguous.
 */
function quoteOptionsValue(value: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(value) ? value : `"${value}"`;
}

function printOptionsBlock(ast: CkRootNode): string | null {
    const hasMeta = Object.keys(ast.meta).length > 0;
    const hasServices = Object.keys(ast.services).length > 0;
    const hasSecurity = ast.security !== undefined;
    const hasRequestHeaders = (ast.requestHeaders?.length ?? 0) > 0;
    const hasResponseHeaders = (ast.responseHeaders?.length ?? 0) > 0;

    if (!hasMeta && !hasServices && !hasSecurity && !hasRequestHeaders && !hasResponseHeaders) return null;

    const lines: string[] = ['options {'];

    if (hasMeta) {
        lines.push(`${INDENT}keys: {`);
        for (const [key, value] of Object.entries(ast.meta)) {
            lines.push(`${INDENT}${INDENT}${key}: ${quoteOptionsValue(value)}`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasServices) {
        lines.push(`${INDENT}services: {`);
        for (const [key, value] of Object.entries(ast.services)) {
            lines.push(`${INDENT}${INDENT}${key}: ${quoteOptionsValue(value)}`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasRequestHeaders) {
        lines.push(...printOptionsHeaderScope('request', ast.requestHeaders!));
    }

    if (hasResponseHeaders) {
        lines.push(...printOptionsHeaderScope('response', ast.responseHeaders!));
    }

    if (hasSecurity) {
        lines.push(...printSecurity(ast.security!, INDENT, INDENT + INDENT));
    }

    lines.push('}');
    return lines.join('\n');
}

function printOptionsHeaderScope(keyword: 'request' | 'response', headers: OpResponseHeaderNode[]): string[] {
    const I2 = INDENT + INDENT;
    const I3 = INDENT + INDENT + INDENT;
    const lines = [`${INDENT}${keyword}: {`, `${I2}headers: {`];
    for (const h of headers) {
        const opt = h.optional ? '?' : '';
        const trail = h.description ? ` # ${h.description}` : '';
        lines.push(`${I3}${h.name}${opt}: ${printType(h.type)}${trail}`);
    }
    lines.push(`${I2}}`);
    lines.push(`${INDENT}}`);
    return lines;
}

// ─── CK file printer ───────────────────────────────────────────────────────

/**
 * Render a parsed `.ck` AST back to source. Output is byte-identical on
 * round-trip when the input is already canonically formatted: options block
 * first, then contracts, then operations, separated by blank lines.
 *
 * `printWidth` is forwarded to per-model printing for line wrapping inside
 * inline-object types.
 */
export function printCk(ast: CkRootNode, printWidth: number = DEFAULT_PRINT_WIDTH): string {
    const parts: string[] = [];

    // Options block
    const options = printOptionsBlock(ast);
    if (options) parts.push(options);

    // Contracts (models)
    for (const model of ast.models) {
        if (parts.length > 0) parts.push('');
        parts.push(`contract ${printModelDecl(model, printWidth)}`);
    }

    // Operations (routes)
    const emptyBlocks: CommentBlock[] = [];
    const emptyIdx = { value: 0 };
    for (const route of ast.routes) {
        if (parts.length > 0) parts.push('');
        const modPart = route.modifiers?.length ? `(${route.modifiers[0]})` : '';
        parts.push(`operation${modPart} ${printRoute(route, emptyBlocks, emptyIdx, Infinity)}`);
    }

    return parts.join('\n') + '\n';
}
