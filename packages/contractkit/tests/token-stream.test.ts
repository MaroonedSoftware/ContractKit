import { adaptTokens } from '../src/token-adapter.js';
import type { Token, TokenKind } from '../src/lexer.js';
import { Identifier, Colon, Eof, StringLit, NumberLit, BooleanLit, Comment, LBrace, RBrace } from '../src/tokens.js';

function tok(kind: TokenKind, value = '', line = 1): Token {
  return { kind, value, line };
}

describe('adaptTokens', () => {
  it('converts basic tokens to Chevrotain IToken format', () => {
    const raw: Token[] = [tok('IDENTIFIER', 'User', 1), tok('COLON', ':', 1), tok('EOF', '', 1)];
    const { tokens } = adaptTokens(raw);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]!.tokenType).toBe(Identifier);
    expect(tokens[0]!.image).toBe('User');
    expect(tokens[0]!.startLine).toBe(1);
    expect(tokens[1]!.tokenType).toBe(Colon);
  });

  it('strips COMMENT tokens into comments map', () => {
    const raw: Token[] = [
      tok('COMMENT', 'A description', 1),
      tok('IDENTIFIER', 'User', 2),
      tok('LBRACE', '{', 2),
      tok('RBRACE', '}', 2),
      tok('EOF', '', 3),
    ];
    const { tokens, comments } = adaptTokens(raw);

    // Comments should not appear in the token stream
    const commentTokens = tokens.filter(t => t.tokenType === Comment);
    expect(commentTokens).toHaveLength(0);

    // Comments should be in the map
    expect(comments.get(1)).toBe('A description');
  });

  it('preserves line numbers on tokens', () => {
    const raw: Token[] = [tok('IDENTIFIER', 'a', 3), tok('COLON', ':', 3), tok('IDENTIFIER', 'string', 3), tok('EOF', '', 4)];
    const { tokens } = adaptTokens(raw);
    expect(tokens[0]!.startLine).toBe(3);
    expect(tokens[0]!.endLine).toBe(3);
  });

  it('maps all token kinds correctly', () => {
    const raw: Token[] = [
      tok('IDENTIFIER', 'name', 1),
      tok('LBRACE', '{', 1),
      tok('RBRACE', '}', 1),
      tok('STRING', 'hello', 1),
      tok('NUMBER', '42', 1),
      tok('BOOLEAN', 'true', 1),
      tok('EOF', '', 1),
    ];
    const { tokens } = adaptTokens(raw);
    expect(tokens[0]!.tokenType).toBe(Identifier);
    expect(tokens[1]!.tokenType).toBe(LBrace);
    expect(tokens[2]!.tokenType).toBe(RBrace);
    expect(tokens[3]!.tokenType).toBe(StringLit);
    expect(tokens[4]!.tokenType).toBe(NumberLit);
    expect(tokens[5]!.tokenType).toBe(BooleanLit);
    expect(tokens[6]!.tokenType).toBe(Eof);
  });

  it('assigns monotonically increasing offsets', () => {
    const raw: Token[] = [tok('IDENTIFIER', 'a', 1), tok('COLON', ':', 1), tok('IDENTIFIER', 'b', 1), tok('EOF', '', 1)];
    const { tokens } = adaptTokens(raw);
    for (let i = 1; i < tokens.length; i++) {
      expect(tokens[i]!.startOffset).toBeGreaterThan(tokens[i - 1]!.startOffset);
    }
  });

  it('handles multiple comments on different lines', () => {
    const raw: Token[] = [tok('COMMENT', 'First comment', 1), tok('COMMENT', 'Second comment', 3), tok('EOF', '', 4)];
    const { tokens, comments } = adaptTokens(raw);

    // No comment tokens in stream
    expect(tokens.filter(t => t.tokenType === Comment)).toHaveLength(0);

    // Both comments in map
    expect(comments.get(1)).toBe('First comment');
    expect(comments.get(3)).toBe('Second comment');
  });

  it('handles empty input (only EOF)', () => {
    const raw: Token[] = [tok('EOF', '', 1)];
    const { tokens, comments } = adaptTokens(raw);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.tokenType).toBe(Eof);
    expect(comments.size).toBe(0);
  });

  it('preserves token image values', () => {
    const raw: Token[] = [tok('STRING', 'hello world', 1), tok('NUMBER', '3.14', 1), tok('BOOLEAN', 'false', 1), tok('EOF', '', 1)];
    const { tokens } = adaptTokens(raw);
    expect(tokens[0]!.image).toBe('hello world');
    expect(tokens[1]!.image).toBe('3.14');
    expect(tokens[2]!.image).toBe('false');
  });
});
