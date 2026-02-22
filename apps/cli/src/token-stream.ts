import type { Token, TokenKind } from './lexer.js';

export class ParseError extends Error {
  readonly line: number;
  readonly file: string;

  constructor(message: string, line: number, file: string) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
    this.file = file;
  }
}

export class TokenStream {
  private readonly tokens: Token[];
  private readonly file: string;
  private pos = 0;

  constructor(tokens: Token[], file: string) {
    this.tokens = tokens;
    this.file = file;
  }

  /** Return the token at current position + offset without consuming. */
  peek(offset = 0): Token {
    const idx = this.pos + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!; // EOF sentinel
    }
    return this.tokens[idx]!;
  }

  /** Return the current token and advance position by one. */
  consume(): Token {
    const tok = this.tokens[this.pos]!;
    if (this.pos < this.tokens.length - 1) {
      this.pos++;
    }
    return tok;
  }

  /** Consume and return the current token if it matches `kind`; otherwise throw ParseError. */
  expect(kind: TokenKind): Token {
    const tok = this.peek();
    if (tok.kind !== kind) {
      throw new ParseError(
        `Expected ${kind}, got ${tok.kind} ("${tok.value}")`,
        tok.line,
        this.file,
      );
    }
    return this.consume();
  }

  /** If the current token matches `kind`, consume it and return true; otherwise return false. */
  match(kind: TokenKind): boolean {
    if (this.peek().kind === kind) {
      this.consume();
      return true;
    }
    return false;
  }

  /** Consume all consecutive NEWLINE tokens at the current position. */
  skipNewlines(): void {
    while (this.peek().kind === 'NEWLINE') {
      this.consume();
    }
  }
}
