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
  let inFrontMatter = false;
  let parenDepth = 0;
  let braceDepth = 0;
  // Tracks the brace depth at which each open paren was opened.
  // Used to detect when : or / appears inside a type-arg () at the same brace level
  // (format strings) vs inside a nested {} within those parens (field separators).
  const parenBraceStack: number[] = [];

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const rawLine = lines[lineNum]!;
    const lineNo = lineNum + 1;

    // Blank lines are skipped
    if (rawLine.trim() === '') continue;

    const trimmed = rawLine.trim();

    // Front-matter delimiter: three or more dashes on their own line
    if (/^-{3,}$/.test(trimmed)) {
      tokens.push({ kind: 'TRIPLE_DASH', value: '---', line: lineNo });
      inFrontMatter = !inFrontMatter;
      continue;
    }

    // Inside front-matter: tokenize as key: value
    // Values are consumed whole (no # comment handling) to support paths like #modules/...
    if (inFrontMatter) {
      const match = trimmed.match(/^([a-zA-Z_$][a-zA-Z0-9_$\-.]*)\s*:\s*(.+)$/);
      if (match) {
        tokens.push({ kind: 'IDENTIFIER', value: match[1]!, line: lineNo });
        tokens.push({ kind: 'COLON', value: ':', line: lineNo });
        let value = match[2]!.trim();
        // Strip surrounding quotes if present, emit as STRING either way
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        tokens.push({ kind: 'STRING', value, line: lineNo });
      }
      continue;
    }

    if (trimmed.startsWith('#')) {
      tokens.push({ kind: 'COMMENT', value: trimmed.slice(1).trim(), line: lineNo });
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
        case '(': parenBraceStack.push(braceDepth); parenDepth++; tokens.push({ kind: 'LPAREN', value: '(', line: lineNo }); pos++; continue;
        case ')': parenBraceStack.pop(); parenDepth--; tokens.push({ kind: 'RPAREN', value: ')', line: lineNo }); pos++; continue;
        case '{': braceDepth++; tokens.push({ kind: 'LBRACE', value: '{', line: lineNo }); pos++; continue;
        case '}': braceDepth--; tokens.push({ kind: 'RBRACE', value: '}', line: lineNo }); pos++; continue;
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
        while (end < content.length) {
          const ch = content[end]!;
          if (/[a-zA-Z0-9_$\-.]/.test(ch)) {
            end++;
          } else if (
            parenDepth > 0 &&
            parenBraceStack[parenBraceStack.length - 1] === braceDepth &&
            (ch === ':' || ch === '/') &&
            end + 1 < content.length && /[a-zA-Z0-9]/.test(content[end + 1]!)
          ) {
            // Inside type-arg parens at the same brace level: treat : and / as format-string separators
            end++;
          } else {
            break;
          }
        }
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
