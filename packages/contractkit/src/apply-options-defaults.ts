/**
 * Normalization pass — merges options-level request/response headers into each operation's AST
 * so downstream codegen plugins remain unaware of the options-vs-operation distinction.
 *
 * Runs after parsing and before validation. Mutates the root in place.
 *
 * Idempotent: re-running on an already-merged AST is a no-op. A previously injected global
 * header is recognized as structurally identical to its source global (`headerMatchesGlobal`)
 * and skipped silently, so a second pass neither duplicates it nor misreports it as an
 * operation-level override.
 *
 * Merge rules:
 * - Request headers: applied to every operation. Op-level headers with the same name win.
 *   If the op declares `headers: none`, the merge is skipped. If the op uses a referenced
 *   or compound type for headers (rather than inline params), the merge is skipped with a warning.
 * - Response headers: applied to every status code on every operation, regardless of body
 *   presence or status class. Per-status `headers: none` skips the merge for that code.
 *   Per-status header with same name wins.
 */
import type { CkRootNode, OpOperationNode, OpParamNode, OpResponseHeaderNode, OpResponseNode, OpRootNode } from './ast.js';
import type { DiagnosticCollector } from './diagnostics.js';
import { extractPathParams } from './path-params.js';

type RootWithGlobals = Pick<CkRootNode, 'file' | 'routes' | 'requestHeaders' | 'responseHeaders'> | Pick<OpRootNode, 'file' | 'routes' | 'requestHeaders' | 'responseHeaders'>;

export function applyOptionsDefaults(root: RootWithGlobals, diag: DiagnosticCollector): void {
    const reqGlobals = root.requestHeaders ?? [];
    const resGlobals = root.responseHeaders ?? [];
    if (reqGlobals.length === 0 && resGlobals.length === 0) return;

    for (const route of root.routes) {
        const pathParams = new Set(extractPathParams(route.path));
        for (const g of reqGlobals) {
            if (pathParams.has(g.name)) {
                diag.error(root.file, route.loc.line, `Global request header '${g.name}' collides with path parameter on '${route.path}'`);
            }
        }

        for (const op of route.operations) {
            mergeRequestHeaders(op, reqGlobals, root.file, diag);
            for (const res of op.responses) mergeResponseHeaders(res, resGlobals);
        }
    }
}

function mergeRequestHeaders(op: OpOperationNode, globals: OpResponseHeaderNode[], file: string, diag: DiagnosticCollector): void {
    if (globals.length === 0 || op.requestHeadersOptOut) return;

    const src = op.headers;
    if (src && (src.kind === 'ref' || src.kind === 'type')) {
        diag.warn(
            file,
            op.loc.line,
            `Operation uses a referenced headers type — global request headers from options are not merged. Inline the headers or use 'headers: none' to silence.`,
        );
        return;
    }

    const existing: OpParamNode[] = src?.kind === 'params' ? src.nodes : [];
    const existingByName = new Map(existing.map(p => [p.name, p]));
    const additions: OpParamNode[] = [];
    const overridden: string[] = [];

    for (const g of globals) {
        const match = existingByName.get(g.name);
        if (match) {
            // Structurally identical to the global → treat as already-merged and skip silently
            // (keeps the pass idempotent when re-run on an AST it previously mutated). Only a
            // genuinely different op-declared header of the same name counts as an override.
            if (headerMatchesGlobal(match, g)) continue;
            overridden.push(g.name);
            continue;
        }
        additions.push(headerToParam(g, op));
    }

    if (overridden.length > 0) {
        diag.warn(file, op.loc.line, `Operation overrides global request header${overridden.length > 1 ? 's' : ''} ${overridden.map(n => `'${n}'`).join(', ')}`);
    }

    if (additions.length === 0 && src) return;
    op.headers = { kind: 'params', nodes: [...additions, ...existing] };
}

function mergeResponseHeaders(res: OpResponseNode, globals: OpResponseHeaderNode[]): void {
    if (globals.length === 0 || res.headersOptOut) return;

    const existing = res.headers ?? [];
    const existingNames = new Set(existing.map(h => h.name));
    const additions = globals.filter(g => !existingNames.has(g.name));
    if (additions.length === 0 && res.headers) return;

    res.headers = [...additions, ...existing];
}

/** True when an existing op header is structurally identical to a global header
 * (same name, optionality, and type). Used to detect an already-merged global so a
 * second pass over the same AST doesn't misread it as an operation-level override. */
function headerMatchesGlobal(existing: OpParamNode, g: OpResponseHeaderNode): boolean {
    if (existing.name !== g.name) return false;
    if (!!existing.optional !== !!g.optional) return false;
    return JSON.stringify(existing.type) === JSON.stringify(g.type);
}

function headerToParam(h: OpResponseHeaderNode, op: OpOperationNode): OpParamNode {
    const param: OpParamNode = {
        name: h.name,
        optional: h.optional,
        nullable: false,
        type: h.type,
        loc: op.loc,
    };
    if (h.description) param.description = h.description;
    return param;
}
