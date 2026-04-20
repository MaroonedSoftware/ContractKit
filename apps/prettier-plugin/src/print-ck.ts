import type { CkRootNode } from '@contractkit/core';
import { printModelDecl } from './print-contract.js';
import { printRoute, printSecurity, type CommentBlock } from './print-operation.js';
import { INDENT } from './indent.js';

export const DEFAULT_PRINT_WIDTH = 80;

// ─── Options block ──────────────────────────────────────────────────────────

function printOptionsBlock(ast: CkRootNode): string | null {
    const hasMeta = Object.keys(ast.meta).length > 0;
    const hasServices = Object.keys(ast.services).length > 0;
    const hasSecurity = ast.security !== undefined;

    if (!hasMeta && !hasServices && !hasSecurity) return null;

    const lines: string[] = ['options {'];

    if (hasMeta) {
        lines.push(`${INDENT}keys: {`);
        for (const [key, value] of Object.entries(ast.meta)) {
            const v = value.startsWith('#') || value.includes(' ') ? `"${value}"` : value;
            lines.push(`${INDENT}${INDENT}${key}: ${v}`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasServices) {
        lines.push(`${INDENT}services: {`);
        for (const [key, value] of Object.entries(ast.services)) {
            const v = value.startsWith('#') || value.includes(' ') ? `"${value}"` : value;
            lines.push(`${INDENT}${INDENT}${key}: ${v}`);
        }
        lines.push(`${INDENT}}`);
    }

    if (hasSecurity) {
        lines.push(...printSecurity(ast.security!, INDENT, INDENT + INDENT));
    }

    lines.push('}');
    return lines.join('\n');
}

// ─── CK file printer ───────────────────────────────────────────────────────

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
