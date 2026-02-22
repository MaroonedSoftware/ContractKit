import type { IToken } from 'chevrotain';
import type { Token } from './lexer.js';
import { tokenKindMap } from './tokens.js';

export interface AdaptedTokens {
  tokens: IToken[];
  comments: Map<number, string>; // line number -> comment text
}

/**
 * Converts our lexer's Token[] into Chevrotain's IToken[] format.
 * COMMENT tokens are extracted into a side map keyed by line number
 * so visitors can use them for model/field descriptions.
 */
export function adaptTokens(rawTokens: Token[]): AdaptedTokens {
  const tokens: IToken[] = [];
  const comments = new Map<number, string>();
  let offset = 0;

  for (const tok of rawTokens) {
    if (tok.kind === 'COMMENT') {
      comments.set(tok.line, tok.value);
      continue;
    }

    const tokenType = tokenKindMap[tok.kind];
    if (!tokenType) continue;

    const image = tok.value || tok.kind;
    const len = image.length || 1;

    tokens.push({
      image: tok.value,
      startOffset: offset,
      endOffset: offset + len - 1,
      startLine: tok.line,
      endLine: tok.line,
      startColumn: 0,
      endColumn: len - 1,
      tokenTypeIdx: tokenType.tokenTypeIdx!,
      tokenType,
    });

    offset += len + 1;
  }

  return { tokens, comments };
}
