import { tokenize } from './lexer.js';
import { adaptTokens } from './token-adapter.js';
import { dtoCstParser } from './chevrotain-parser-dto.js';
import { DtoVisitor } from './visitor-dto.js';
import { DiagnosticCollector } from './diagnostics.js';
import type { DtoRootNode } from './ast.js';

export function parseDto(source: string, file: string, diag: DiagnosticCollector): DtoRootNode {
  // Step 1: Tokenize with existing lexer (handles indentation)
  const rawTokens = tokenize(source, file);

  // Step 2: Adapt to Chevrotain IToken format (strips comments to side map)
  const { tokens, comments } = adaptTokens(rawTokens);

  // Step 3: Parse to CST
  dtoCstParser.input = tokens;
  const cst = dtoCstParser.dtoRoot();

  // Step 4: Report parse errors to diagnostics
  for (const err of dtoCstParser.errors) {
    const line = err.token?.startLine ?? 0;
    diag.error(file, line, err.message);
  }

  // Step 5: Visit CST to build AST (consumed comments are deleted from the map)
  const visitor = new DtoVisitor(file, comments);
  const ast = visitor.visit(cst);

  // Step 6: Remaining entries in comments are orphans (not attached to any node)
  const orphanComments = Array.from(comments.entries())
    .map(([line, text]) => ({ line, text }))
    .sort((a, b) => a.line - b.line);

  return orphanComments.length > 0 ? { ...ast, orphanComments } : ast;
}
