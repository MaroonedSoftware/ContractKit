import { tokenize } from './lexer.js';
import { adaptTokens } from './token-adapter.js';
import { opCstParser } from './chevrotain-parser-op.js';
import { OpVisitor } from './visitor-op.js';
import { DiagnosticCollector } from './diagnostics.js';
import type { OpRootNode } from './ast.js';

export function parseOp(source: string, file: string, diag: DiagnosticCollector): OpRootNode {
  // Step 1: Tokenize with existing lexer (handles indentation)
  const rawTokens = tokenize(source, file);

  // Step 2: Adapt to Chevrotain IToken format (strips comments to side map)
  const { tokens, comments } = adaptTokens(rawTokens);

  // Step 3: Parse to CST
  opCstParser.input = tokens;
  const cst = opCstParser.opRoot();

  // Step 4: Report parse errors to diagnostics
  for (const err of opCstParser.errors) {
    const line = err.token?.startLine ?? 0;
    diag.error(file, line, err.message);
  }

  // Step 5: Visit CST to build AST
  const visitor = new OpVisitor(file, diag, comments);
  return visitor.visit(cst);
}
