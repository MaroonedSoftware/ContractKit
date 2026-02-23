import { createToken, type TokenType } from 'chevrotain';

// ─── Token type definitions ─────────────────────────────────────────────────
// These are used by Chevrotain's parser for grammar rules and lookahead.
// We use our own external lexer, so the patterns here are documentation only.

export const Comment    = createToken({ name: 'Comment',    pattern: /#[^\n]*/ });
export const BooleanLit = createToken({ name: 'BooleanLit', pattern: /true|false/ });
export const Identifier = createToken({ name: 'Identifier', pattern: /[a-zA-Z_$][a-zA-Z0-9_$\-.]*/});
export const Colon      = createToken({ name: 'Colon',      pattern: /:/ });
export const Question   = createToken({ name: 'Question',   pattern: /\?/ });
export const Equals     = createToken({ name: 'Equals',     pattern: /=/ });
export const Pipe       = createToken({ name: 'Pipe',       pattern: /\|/ });
export const LParen     = createToken({ name: 'LParen',     pattern: /\(/ });
export const RParen     = createToken({ name: 'RParen',     pattern: /\)/ });
export const LBrace     = createToken({ name: 'LBrace',     pattern: /\{/ });
export const RBrace     = createToken({ name: 'RBrace',     pattern: /\}/ });
export const Comma      = createToken({ name: 'Comma',      pattern: /,/ });
export const Slash      = createToken({ name: 'Slash',      pattern: /\// });
export const StringLit  = createToken({ name: 'StringLit',  pattern: /"[^"]*"|'[^']*'/ });
export const NumberLit  = createToken({ name: 'NumberLit',  pattern: /-?\d+(\.\d+)?/ });
export const Eof        = createToken({ name: 'Eof',        pattern: /<<EOF>>/ });

// Token vocabulary — order matters for parser lookahead priority
export const allTokens: TokenType[] = [
  Comment,
  BooleanLit,   // before Identifier so "true"/"false" don't match as identifiers
  Identifier,
  Colon, Question, Equals, Pipe,
  LParen, RParen, LBrace, RBrace,
  Comma, Slash,
  StringLit, NumberLit,
  Eof,
];

// Map from our lexer's TokenKind string to Chevrotain TokenType
export const tokenKindMap: Record<string, TokenType> = {
  IDENTIFIER: Identifier,
  COLON:      Colon,
  QUESTION:   Question,
  EQUALS:     Equals,
  PIPE:       Pipe,
  LPAREN:     LParen,
  RPAREN:     RParen,
  LBRACE:     LBrace,
  RBRACE:     RBrace,
  COMMA:      Comma,
  SLASH:      Slash,
  STRING:     StringLit,
  NUMBER:     NumberLit,
  BOOLEAN:    BooleanLit,
  COMMENT:    Comment,
  EOF:        Eof,
};
