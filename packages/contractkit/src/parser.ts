/**
 * Contract DSL Parser — Ohm grammar-driven implementation.
 * Parses .ck files containing contract and operation declarations.
 */
import { grammar } from './grammar.js';
import { createSemantics } from './semantics.js';
import { DiagnosticCollector } from './diagnostics.js';
import type { CkRootNode } from './ast.js';

const semantics = createSemantics(grammar);

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
