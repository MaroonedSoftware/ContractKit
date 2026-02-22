import { TokenStream, ParseError } from '../src/token-stream.js';
import type { Token, TokenKind } from '../src/lexer.js';

function tok(kind: TokenKind, value = '', line = 1): Token {
  return { kind, value, line };
}

function makeStream(tokens: Token[], file = 'test.dto'): TokenStream {
  return new TokenStream(tokens, file);
}

describe('TokenStream', () => {
  // ─── peek() ──────────────────────────────────────────────────────

  describe('peek()', () => {
    it('returns current token without consuming', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('EOF')]);
      const first = stream.peek();
      const second = stream.peek();
      expect(first).toBe(second);
      expect(first.kind).toBe('IDENTIFIER');
    });

    it('returns token at offset', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('COLON'), tok('EOF')]);
      expect(stream.peek(0).kind).toBe('IDENTIFIER');
      expect(stream.peek(1).kind).toBe('COLON');
    });

    it('returns EOF sentinel when peeking past end', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('EOF')]);
      const result = stream.peek(10);
      expect(result.kind).toBe('EOF');
    });
  });

  // ─── consume() ──────────────────────────────────────────────────

  describe('consume()', () => {
    it('returns current token and advances', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('COLON'), tok('EOF')]);
      const first = stream.consume();
      expect(first.kind).toBe('IDENTIFIER');
      expect(stream.peek().kind).toBe('COLON');
    });

    it('does not advance past EOF', () => {
      const stream = makeStream([tok('EOF')]);
      const first = stream.consume();
      const second = stream.consume();
      expect(first.kind).toBe('EOF');
      expect(second.kind).toBe('EOF');
    });
  });

  // ─── expect() ───────────────────────────────────────────────────

  describe('expect()', () => {
    it('returns token when kind matches', () => {
      const stream = makeStream([tok('IDENTIFIER', 'hello'), tok('EOF')]);
      const result = stream.expect('IDENTIFIER');
      expect(result.value).toBe('hello');
      expect(stream.peek().kind).toBe('EOF');
    });

    it('throws ParseError when kind does not match', () => {
      const stream = makeStream([tok('IDENTIFIER', 'hello', 5), tok('EOF')]);
      expect(() => stream.expect('COLON')).toThrow(ParseError);
    });

    it('ParseError contains line and file', () => {
      const stream = makeStream([tok('IDENTIFIER', 'x', 7), tok('EOF')], 'my-file.dto');
      try {
        stream.expect('COLON');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(ParseError);
        const pe = e as ParseError;
        expect(pe.line).toBe(7);
        expect(pe.file).toBe('my-file.dto');
        expect(pe.message).toContain('COLON');
        expect(pe.message).toContain('IDENTIFIER');
      }
    });
  });

  // ─── match() ────────────────────────────────────────────────────

  describe('match()', () => {
    it('consumes and returns true when kind matches', () => {
      const stream = makeStream([tok('COLON'), tok('EOF')]);
      const result = stream.match('COLON');
      expect(result).toBe(true);
      expect(stream.peek().kind).toBe('EOF');
    });

    it('returns false without consuming when kind does not match', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('EOF')]);
      const result = stream.match('COLON');
      expect(result).toBe(false);
      expect(stream.peek().kind).toBe('IDENTIFIER');
    });
  });

  // ─── skipNewlines() ─────────────────────────────────────────────

  describe('skipNewlines()', () => {
    it('skips consecutive NEWLINE tokens', () => {
      const stream = makeStream([
        tok('NEWLINE'), tok('NEWLINE'), tok('NEWLINE'),
        tok('IDENTIFIER', 'a'), tok('EOF'),
      ]);
      stream.skipNewlines();
      expect(stream.peek().kind).toBe('IDENTIFIER');
    });

    it('does nothing when not at NEWLINE', () => {
      const stream = makeStream([tok('IDENTIFIER', 'a'), tok('EOF')]);
      stream.skipNewlines();
      expect(stream.peek().kind).toBe('IDENTIFIER');
    });
  });
});

describe('ParseError', () => {
  it('sets name, message, line, and file correctly', () => {
    const err = new ParseError('something went wrong', 5, 'test.dto');
    expect(err.name).toBe('ParseError');
    expect(err.message).toBe('something went wrong');
    expect(err.line).toBe(5);
    expect(err.file).toBe('test.dto');
  });

  it('extends Error', () => {
    const err = new ParseError('msg', 1, 'f');
    expect(err).toBeInstanceOf(Error);
  });
});
