export type TokenKind =
  | 'IDENTIFIER'
  | 'COLON'
  | 'QUESTION'    // ?
  | 'EQUALS'      // =
  | 'PIPE'        // |
  | 'LPAREN'      // (
  | 'RPAREN'      // )
  | 'LBRACE'      // {
  | 'RBRACE'      // }
  | 'COMMA'
  | 'SLASH'       // /
  | 'LBRACKET'    // [  (regex metacharacter)
  | 'RBRACKET'    // ]  (regex metacharacter)
  | 'PLUS'        // +  (regex metacharacter)
  | 'STAR'        // *  (regex metacharacter)
  | 'CARET'       // ^  (regex metacharacter)
  | 'BACKSLASH'   // \  (regex metacharacter)
  | 'DOT'         // .  (regex metacharacter, standalone)
  | 'AMPERSAND'   // &  (intersection type)
  | 'BANG'        // !  (directive prefix)
  | 'TRIPLE_DASH' // --- (front-matter delimiter)
  | 'STRING'      // quoted string value
  | 'NUMBER'      // numeric literal
  | 'BOOLEAN'     // true | false
  | 'COMMENT'     // # ...
  | 'EOF';

export interface Token {
  kind: TokenKind;
  value: string;
  line: number;
}

export function tokenize(source: string, file: string): Token[] {
  const lines = source.split('\n');
  const tokens: Token[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum]!;
    const lineNo = lineNum + 1;

    // Blank lines are skipped
    if (rawLine.trim() === '') continue;

    // Standalone comment line
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('#')) {
      tokens.push({ kind: 'COMMENT', value: trimmed.slice(1).trim(), line: lineNo });
      continue;
    }

    // Front-matter delimiter: three or more dashes on their own line
    if (/^-{3,}$/.test(trimmed)) {
      tokens.push({ kind: 'TRIPLE_DASH', value: '---', line: lineNo });
      continue;
    }

    // Tokenize the line content (after stripping leading whitespace)
    const content = trimmed;
    let pos = 0;

    while (pos < content.length) {
      // Skip spaces within a line
      if (content[pos] === ' ' || content[pos] === '\t') {
        pos++;
        continue;
      }

      // Inline comment
      if (content[pos] === '#') {
        const comment = content.slice(pos + 1).trim();
        tokens.push({ kind: 'COMMENT', value: comment, line: lineNo });
        break;
      }

      // String literal
      if (content[pos] === '"' || content[pos] === "'") {
        const quote = content[pos];
        let end = pos + 1;
        while (end < content.length && content[end] !== quote) end++;
        tokens.push({ kind: 'STRING', value: content.slice(pos + 1, end), line: lineNo });
        pos = end + 1;
        continue;
      }

      // Regex literal inside type modifier: /pattern/
      if (content[pos] === '/' && pos > 0 && content[pos - 1] !== ' ') {
        // treat as part of surrounding identifier — handled in parser
        tokens.push({ kind: 'SLASH', value: '/', line: lineNo });
        pos++;
        continue;
      }

      // Numbers (including negative)
      if (content[pos] === '-' && /\d/.test(content[pos + 1] ?? '')) {
        let end = pos + 1;
        while (end < content.length && /[\d.]/.test(content[end]!)) end++;
        tokens.push({ kind: 'NUMBER', value: content.slice(pos, end), line: lineNo });
        pos = end;
        continue;
      }
      if (/\d/.test(content[pos]!)) {
        let end = pos;
        while (end < content.length && /[\d.]/.test(content[end]!)) end++;
        tokens.push({ kind: 'NUMBER', value: content.slice(pos, end), line: lineNo });
        pos = end;
        continue;
      }

      // Single-char tokens
      switch (content[pos]) {
        case ':': tokens.push({ kind: 'COLON', value: ':', line: lineNo }); pos++; continue;
        case '?': tokens.push({ kind: 'QUESTION', value: '?', line: lineNo }); pos++; continue;
        case '=': tokens.push({ kind: 'EQUALS', value: '=', line: lineNo }); pos++; continue;
        case '|': tokens.push({ kind: 'PIPE', value: '|', line: lineNo }); pos++; continue;
        case '(': tokens.push({ kind: 'LPAREN', value: '(', line: lineNo }); pos++; continue;
        case ')': tokens.push({ kind: 'RPAREN', value: ')', line: lineNo }); pos++; continue;
        case '{': tokens.push({ kind: 'LBRACE', value: '{', line: lineNo }); pos++; continue;
        case '}': tokens.push({ kind: 'RBRACE', value: '}', line: lineNo }); pos++; continue;
        case ',': tokens.push({ kind: 'COMMA', value: ',', line: lineNo }); pos++; continue;
        case '/': tokens.push({ kind: 'SLASH', value: '/', line: lineNo }); pos++; continue;
        case '[': tokens.push({ kind: 'LBRACKET', value: '[', line: lineNo }); pos++; continue;
        case ']': tokens.push({ kind: 'RBRACKET', value: ']', line: lineNo }); pos++; continue;
        case '+': tokens.push({ kind: 'PLUS', value: '+', line: lineNo }); pos++; continue;
        case '*': tokens.push({ kind: 'STAR', value: '*', line: lineNo }); pos++; continue;
        case '^': tokens.push({ kind: 'CARET', value: '^', line: lineNo }); pos++; continue;
        case '\\': tokens.push({ kind: 'BACKSLASH', value: '\\', line: lineNo }); pos++; continue;
        case '.': tokens.push({ kind: 'DOT', value: '.', line: lineNo }); pos++; continue;
        case '&': tokens.push({ kind: 'AMPERSAND', value: '&', line: lineNo }); pos++; continue;
        case '!': tokens.push({ kind: 'BANG', value: '!', line: lineNo }); pos++; continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_$]/.test(content[pos]!)) {
        let end = pos;
        while (end < content.length && /[a-zA-Z0-9_$\-.]/.test(content[end]!)) end++;
        const word = content.slice(pos, end);
        if (word === 'true' || word === 'false') {
          tokens.push({ kind: 'BOOLEAN', value: word, line: lineNo });
        } else {
          tokens.push({ kind: 'IDENTIFIER', value: word, line: lineNo });
        }
        pos = end;
        continue;
      }

      // Unknown — skip
      pos++;
    }
  }

  tokens.push({ kind: 'EOF', value: '', line: lines.length });
  return tokens;
}
