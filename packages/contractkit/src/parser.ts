/**
 * Contract DSL Parser — Ohm grammar-driven implementation.
 * Parses .ck files containing contract and operation declarations.
 */
import { grammar } from './grammar.js';
import { createSemantics } from './semantics.js';
import { DiagnosticCollector } from './diagnostics.js';
import type { CkRootNode } from './ast.js';

const semantics = createSemantics(grammar);

/**
 * Parse a .ck source file into a CkRootNode AST.
 *
 * Does NOT merge options-level header globals into operations — that is a separate
 * normalization step (see `applyOptionsDefaults`) that codegen pipelines opt into.
 * Tools that need the original source shape (e.g. the prettier plugin for round-trip
 * formatting) should use this raw output.
 */
export function parseCk(source: string, file: string, diag: DiagnosticCollector): CkRootNode {
    const match = grammar.match(source, 'Root');

    if (match.failed()) {
        const lineMatch = match.message?.match(/Line (\d+)/);
        const line = lineMatch ? parseInt(lineMatch[1]!, 10) : 0;
        diag.error(file, line, match.message ?? 'Parse error');
        return { kind: 'ckRoot', meta: {}, services: {}, models: [], routes: [], file };
    }

    const ast = semantics(match).toAst(file, diag) as CkRootNode;
    return ast;
}
