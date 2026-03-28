import { tokenize, type Token, type TokenKind } from '../src/lexer.js';

/** Extract just kind+value pairs for easy assertion. */
function kinds(tokens: Token[]): Array<[TokenKind, string]> {
  return tokens.map(t => [t.kind, t.value]);
}

/** Shorthand to get non-EOF tokens for focused assertions. */
function contentTokens(tokens: Token[]): Token[] {
  return tokens.filter(t => t.kind !== 'EOF');
}

describe('tokenize', () => {
  // ─── Basic tokens ────────────────────────────────────────────────

  describe('basic tokens', () => {
    it('tokenizes identifiers', () => {
      const tokens = tokenize('hello', 'test');
      expect(contentTokens(tokens)).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ kind: 'IDENTIFIER', value: 'hello' });
    });

    it('tokenizes single-char tokens', () => {
      const tokens = tokenize(': ? = | ( ) { } , /', 'test');
      const content = contentTokens(tokens);
      const expectedKinds: TokenKind[] = [
        'COLON', 'QUESTION', 'EQUALS', 'PIPE',
        'LPAREN', 'RPAREN', 'LBRACE', 'RBRACE',
        'COMMA', 'SLASH',
      ];
      expect(content.map(t => t.kind)).toEqual(expectedKinds);
    });

    it('tokenizes string literals with double quotes', () => {
      const tokens = tokenize('"hello world"', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'STRING', value: 'hello world' });
    });

    it('tokenizes string literals with single quotes', () => {
      const tokens = tokenize("'hello world'", 'test');
      expect(tokens[0]).toMatchObject({ kind: 'STRING', value: 'hello world' });
    });

    it('tokenizes integer numbers', () => {
      const tokens = tokenize('42', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'NUMBER', value: '42' });
    });

    it('tokenizes decimal numbers', () => {
      const tokens = tokenize('3.14', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'NUMBER', value: '3.14' });
    });

    it('tokenizes negative numbers', () => {
      const tokens = tokenize('-7', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'NUMBER', value: '-7' });
    });

    it('tokenizes boolean true', () => {
      const tokens = tokenize('true', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'BOOLEAN', value: 'true' });
    });

    it('tokenizes boolean false', () => {
      const tokens = tokenize('false', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'BOOLEAN', value: 'false' });
    });
  });

  // ─── Comments ────────────────────────────────────────────────────

  describe('comments', () => {
    it('tokenizes standalone comment lines', () => {
      const tokens = tokenize('# this is a comment', 'test');
      // Standalone comments store the full raw line so the printer can round-trip them verbatim.
      expect(tokens[0]).toMatchObject({ kind: 'COMMENT', value: '# this is a comment' });
    });

    it('tokenizes inline comments', () => {
      const tokens = tokenize('name: string # a field', 'test');
      const comment = tokens.find(t => t.kind === 'COMMENT');
      expect(comment).toMatchObject({ kind: 'COMMENT', value: 'a field' });
    });

    it('skips blank lines', () => {
      const tokens = tokenize('a\n\nb', 'test');
      const idents = tokens.filter(t => t.kind === 'IDENTIFIER');
      expect(idents).toHaveLength(2);
      expect(idents[0]!.value).toBe('a');
      expect(idents[1]!.value).toBe('b');
    });
  });

  // ─── Complex sequences ──────────────────────────────────────────

  describe('complex sequences', () => {
    it('tokenizes a simple model declaration', () => {
      const tokens = tokenize('User { name: string }', 'test');
      const expectedSequence: TokenKind[] = [
        'IDENTIFIER', 'LBRACE',
        'IDENTIFIER', 'COLON', 'IDENTIFIER',
        'RBRACE', 'EOF',
      ];
      expect(tokens.map(t => t.kind)).toEqual(expectedSequence);
      expect(tokens[0]!.value).toBe('User');
      expect(tokens[2]!.value).toBe('name');
      expect(tokens[4]!.value).toBe('string');
    });

    it('tokenizes identifiers with hyphens', () => {
      const tokens = tokenize('content-type', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'IDENTIFIER', value: 'content-type' });
    });

    it('tokenizes identifiers with dots', () => {
      const tokens = tokenize('ledger.categories', 'test');
      expect(tokens[0]).toMatchObject({ kind: 'IDENTIFIER', value: 'ledger.categories' });
    });

    it('preserves line numbers on tokens', () => {
      const tokens = tokenize('a\nb\nc', 'test');
      const idents = tokens.filter(t => t.kind === 'IDENTIFIER');
      expect(idents[0]!.line).toBe(1);
      expect(idents[1]!.line).toBe(2);
      expect(idents[2]!.line).toBe(3);
    });
  });

  // ─── Edge cases ─────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles empty input', () => {
      const tokens = tokenize('', 'test');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.kind).toBe('EOF');
    });

    it('handles input with only whitespace', () => {
      const tokens = tokenize('   \n   ', 'test');
      expect(tokens[tokens.length - 1]!.kind).toBe('EOF');
      const content = contentTokens(tokens);
      expect(content).toHaveLength(0);
    });

    it('tokenizes slash in path context', () => {
      const tokens = tokenize('/api/users', 'test');
      const content = contentTokens(tokens);
      expect(content[0]).toMatchObject({ kind: 'SLASH', value: '/' });
      expect(content[1]).toMatchObject({ kind: 'IDENTIFIER', value: 'api' });
      expect(content[2]).toMatchObject({ kind: 'SLASH', value: '/' });
      expect(content[3]).toMatchObject({ kind: 'IDENTIFIER', value: 'users' });
    });
  });
});
