import type { CkRootNode, OpResponseHeaderNode, OptionsScopeComments } from '@contractkit/core';
import { printModelDecl } from './print-contract.js';
import { printRoute, printSecurity, type CommentBlock } from './print-operation.js';
import { printType } from './print-type.js';
import { INDENT } from './indent.js';

/** Default line width used for wrapping inline-object and enum types when none is supplied. */
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
/**
 * Quote an options value unless it is a bare identifier.
 *
 * An unquoted path (`PetService: #modules/pet/pet.service.js`) parses but is printed quoted,
 * because the AST keeps only the string and not whether the author quoted it. Preserving that
 * choice needs a flag on the entry; quoting is the safe direction, since both forms parse to the
 * same value and the quoted one is what almost every file uses.
 */
function quoteOptionsValue(value: string): string {
    return /^[a-zA-Z_$][a-zA-Z0-9_$\-.]*$/.test(value) ? value : `"${value}"`;
}

/**
 * Emit the `key: value` lines of an options `keys`/`services` sub-block, interleaving any
 * retained comments: leading comments before the entry they precede, and trailing comments
 * after the last entry (before the closing `}`). Keeps comments inside these sub-blocks lossless.
 */
function emitOptionsEntries(lines: string[], entries: Record<string, string>, comments: OptionsScopeComments | undefined): void {
    const I2 = INDENT + INDENT;
    for (const [key, value] of Object.entries(entries)) {
        for (const c of comments?.leading?.[key] ?? []) lines.push(`${I2}# ${c}`);
        const inline = comments?.inline?.[key];
        lines.push(`${I2}${key}: ${quoteOptionsValue(value)}${inline !== undefined ? ` # ${inline}` : ''}`);
    }
    for (const c of comments?.trailing ?? []) lines.push(`${I2}# ${c}`);
}

function printOptionsBlock(ast: CkRootNode): string | null {
    const hasMeta = Object.keys(ast.meta).length > 0;
    const hasServices = Object.keys(ast.services).length > 0;
    const hasSecurity = ast.security !== undefined;
    const hasRequestHeaders = (ast.requestHeaders?.length ?? 0) > 0;
    const hasResponseHeaders = (ast.responseHeaders?.length ?? 0) > 0;

    const hasBodyComments = ast.optionsComments?.body !== undefined;
    if (!hasMeta && !hasServices && !hasSecurity && !hasRequestHeaders && !hasResponseHeaders && !hasBodyComments) return null;

    // A `#` run above the `options` keyword is the file's header comment.
    const lines: string[] = [...(ast.optionsComments?.leading ?? []).map(c => `# ${c}`), 'options {'];
    const body = ast.optionsComments?.body;
    /** Emit the comment run the author wrote directly above this sub-block. */
    const emitLeading = (scope: string) => {
        for (const c of body?.leading?.[scope] ?? []) lines.push(`${INDENT}# ${c}`);
    };

    if (hasMeta) {
        emitLeading('keys');
        lines.push(`${INDENT}keys: {`);
        emitOptionsEntries(lines, ast.meta, ast.optionsComments?.keys);
        lines.push(`${INDENT}}`);
    }

    if (hasServices) {
        emitLeading('services');
        lines.push(`${INDENT}services: {`);
        emitOptionsEntries(lines, ast.services, ast.optionsComments?.services);
        lines.push(`${INDENT}}`);
    }

    if (hasRequestHeaders) {
        emitLeading('request');
        lines.push(...printOptionsHeaderScope('request', ast.requestHeaders!));
    }

    if (hasResponseHeaders) {
        emitLeading('response');
        lines.push(...printOptionsHeaderScope('response', ast.responseHeaders!));
    }

    if (hasSecurity) {
        emitLeading('security');
        lines.push(...printSecurity(ast.security!, INDENT, INDENT + INDENT));
    }

    for (const c of body?.trailing ?? []) lines.push(`${INDENT}# ${c}`);

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
 * Render a parsed `.ck` AST back to source: options block first, then contracts, then
 * operations, separated by blank lines.
 *
 * Printing is the inverse of parsing — for well-formed source, `printCk(parseCk(text))` returns
 * `text` unchanged. That holds because the AST carries the author's layout alongside the
 * semantics: comment placement (`leadingComments`, `descriptionInline`), operation body key
 * order (`keyOrder`), blank lines (`blankLineBefore`), and single-line response blocks
 * (`inline`). Preserve those rather than canonicalizing them, or `pnpm format` silently
 * rewrites the user's file. See `tests/round-trip.test.ts`.
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
        parts.push(printDeclLeadIn(model.leadingComments, model.descriptionInline ? undefined : model.description) + `contract ${printModelDecl(model, printWidth)}`);
    }

    // Operations (routes)
    const emptyBlocks: CommentBlock[] = [];
    const emptyIdx = { value: 0 };
    for (const route of ast.routes) {
        if (parts.length > 0) parts.push('');
        const modPart = route.modifiers?.length ? `(${route.modifiers[0]})` : '';
        parts.push(printDeclLeadIn(route.leadingComments, route.description) + `operation${modPart} ${printRoute(route, emptyBlocks, emptyIdx, Infinity)}`);
    }

    return parts.join('\n') + '\n';
}

/**
 * Build the comment lines that precede a top-level declaration: any standalone block (a section
 * divider and the like, kept separated by the blank line the author wrote), then the declaration's
 * own doc comment on the lines immediately above it. Returns `''` when there is neither.
 */
function printDeclLeadIn(leadingComments: string[] | undefined, description: string | undefined): string {
    const lines: string[] = [];
    if (leadingComments?.length) {
        for (const c of leadingComments) lines.push(`# ${c}`);
        lines.push('');
    }
    if (description) {
        for (const line of description.split('\n')) lines.push(`# ${line}`);
    }
    return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
