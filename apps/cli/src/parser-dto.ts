import { tokenize } from './lexer.js';
import { TokenStream, ParseError } from './token-stream.js';
import { DiagnosticCollector } from './diagnostics.js';
import type {
  DtoRootNode, ModelNode, FieldNode, DtoTypeNode,
  ScalarTypeNode, ArrayTypeNode, TupleTypeNode, RecordTypeNode,
  EnumTypeNode, LiteralTypeNode, UnionTypeNode, ModelRefTypeNode,
  InlineObjectTypeNode,
} from './ast.js';

// ─── Public entry point ────────────────────────────────────────────────────

export function parseDto(source: string, file: string, diag: DiagnosticCollector): DtoRootNode {
  const tokens = tokenize(source, file);
  const stream = new TokenStream(tokens, file);
  const models: ModelNode[] = [];

  stream.skipNewlines();

  while (stream.peek().kind !== 'EOF') {
    try {
      const model = parseModel(stream, file);
      if (model) models.push(model);
    } catch (e) {
      if (e instanceof ParseError) {
        diag.error(e.file, e.line, e.message);
        // Skip to next top-level model (DEDENT back to indent 0)
        while (stream.peek().kind !== 'EOF' && stream.peek().kind !== 'DEDENT') {
          stream.consume();
        }
        stream.match('DEDENT');
      } else {
        throw e;
      }
    }
    stream.skipNewlines();
  }

  return { kind: 'dtoRoot', models, file };
}

// ─── Model ─────────────────────────────────────────────────────────────────

function parseModel(stream: TokenStream, file: string): ModelNode | null {
  stream.skipNewlines();
  if (stream.peek().kind === 'EOF') return null;

  // Optional leading comment becomes model description
  let description: string | undefined;
  if (stream.peek().kind === 'COMMENT') {
    description = stream.consume().value;
    stream.skipNewlines();
  }

  const nameTok = stream.expect('IDENTIFIER');
  const loc = { file, line: nameTok.line };

  // Optional base model:  ModelName: BaseModel
  let base: string | undefined;
  stream.expect('COLON');

  if (stream.peek().kind === 'IDENTIFIER') {
    // Could be base model name or first field — peek at next token
    // If followed by NEWLINE or INDENT it's a base model name
    const next = stream.peek(1);
    if (next.kind === 'NEWLINE' || next.kind === 'EOF') {
      base = stream.consume().value;
    }
  }

  // Inline comment on model line becomes description if not already set
  if (stream.peek().kind === 'COMMENT') {
    if (!description) description = stream.consume().value;
    else stream.consume();
  }

  stream.match('NEWLINE');

  // Fields are inside an INDENT block
  const fields: FieldNode[] = [];
  if (stream.peek().kind === 'INDENT') {
    stream.consume(); // consume INDENT
    fields.push(...parseFields(stream, file));
    stream.match('DEDENT');
  }

  return { kind: 'model', name: nameTok.value, base, fields, description, loc };
}

// ─── Fields ────────────────────────────────────────────────────────────────

function parseFields(stream: TokenStream, file: string): FieldNode[] {
  const fields: FieldNode[] = [];

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT' || stream.peek().kind === 'EOF') break;

    // Standalone comment — becomes next field's description
    let pendingDesc: string | undefined;
    if (stream.peek().kind === 'COMMENT') {
      pendingDesc = stream.consume().value;
      stream.skipNewlines();
      if (stream.peek().kind === 'DEDENT' || stream.peek().kind === 'EOF') break;
    }

    const field = parseField(stream, file, pendingDesc);
    if (field) fields.push(field);
  }

  return fields;
}

function parseField(stream: TokenStream, file: string, pendingDesc?: string): FieldNode | null {
  if (stream.peek().kind !== 'IDENTIFIER') {
    stream.consume();
    return null;
  }

  const nameTok = stream.consume();
  const loc = { file, line: nameTok.line };

  // Optional ?
  const optional = stream.peek().kind === 'QUESTION' ? (stream.consume(), true) : false;

  stream.expect('COLON');

  // Check for visibility modifier
  let visibility: 'readonly' | 'writeonly' | 'normal' = 'normal';
  if (stream.peek().kind === 'IDENTIFIER') {
    const v = stream.peek().value;
    if (v === 'readonly' || v === 'writeonly') {
      visibility = v as 'readonly' | 'writeonly';
      stream.consume();
    }
  }

  // Check for nested object (no type on this line, NEWLINE then INDENT)
  const nextTok = stream.peek();
  if (nextTok.kind === 'NEWLINE' || nextTok.kind === 'COMMENT' || nextTok.kind === 'EOF') {
    // Possibly nested object — consume comment/newline then look for INDENT
    let desc = pendingDesc;
    if (nextTok.kind === 'COMMENT') {
      if (!desc) desc = stream.consume().value;
      else stream.consume();
    }
    stream.match('NEWLINE');
    if (stream.peek().kind === 'INDENT') {
      stream.consume();
      const subFields = parseFields(stream, file);
      stream.match('DEDENT');
      const type: InlineObjectTypeNode = { kind: 'inlineObject', fields: subFields };
      return { name: nameTok.value, optional, nullable: false, visibility, type, description: desc, loc };
    }
    return null;
  }

  // Parse type expression (possibly union)
  const type = parseTypeExpression(stream, file);

  // Check for nullable: | null
  let nullable = false;
  if ((type as UnionTypeNode).kind === 'union') {
    const union = type as UnionTypeNode;
    const nullIdx = union.members.findIndex(m => m.kind === 'scalar' && (m as ScalarTypeNode).name === 'null');
    if (nullIdx !== -1) {
      nullable = true;
      union.members.splice(nullIdx, 1);
      if (union.members.length === 1) {
        // Unwrap single-member union
        return buildField(nameTok.value, optional, nullable, visibility, union.members[0], stream, pendingDesc, loc);
      }
    }
  } else if (type.kind === 'scalar' && type.name === 'null') {
    nullable = true;
  }

  return buildField(nameTok.value, optional, nullable, visibility, type, stream, pendingDesc, loc);
}

function buildField(
  name: string,
  optional: boolean,
  nullable: boolean,
  visibility: 'readonly' | 'writeonly' | 'normal',
  type: DtoTypeNode,
  stream: TokenStream,
  pendingDesc: string | undefined,
  loc: { file: string; line: number },
): FieldNode {
  // Default value
  let defaultVal: string | number | boolean | undefined;
  if (stream.peek().kind === 'EQUALS') {
    stream.consume();
    const val = stream.consume();
    if (val.kind === 'STRING') defaultVal = val.value;
    else if (val.kind === 'NUMBER') defaultVal = Number(val.value);
    else if (val.kind === 'BOOLEAN') defaultVal = val.value === 'true';
    else if (val.kind === 'IDENTIFIER') defaultVal = val.value;
  }

  // Inline comment
  let description = pendingDesc;
  if (stream.peek().kind === 'COMMENT') {
    const c = stream.consume().value;
    if (!description) description = c;
  }

  stream.match('NEWLINE');

  return { name, optional, nullable, visibility, type, default: defaultVal, description, loc };
}

// ─── Type expression parser ────────────────────────────────────────────────

function parseTypeExpression(stream: TokenStream, file: string): DtoTypeNode {
  const members: DtoTypeNode[] = [parseSingleType(stream, file)];

  while (stream.peek().kind === 'PIPE') {
    stream.consume(); // consume |
    members.push(parseSingleType(stream, file));
  }

  if (members.length === 1) return members[0];
  return { kind: 'union', members };
}

function parseSingleType(stream: TokenStream, file: string): DtoTypeNode {
  const tok = stream.peek();

  // Inline object: { field: type, ... }
  if (tok.kind === 'LBRACE') {
    return parseInlineBraceObject(stream, file);
  }

  if (tok.kind !== 'IDENTIFIER') {
    throw new ParseError(`Expected type name, got ${tok.kind}`, tok.line, file);
  }

  const name = stream.consume().value;

  // Types with parenthesized modifiers
  switch (name) {
    case 'array':  return parseArrayType(stream, file);
    case 'tuple':  return parseTupleType(stream, file);
    case 'record': return parseRecordType(stream, file);
    case 'enum':   return parseEnumType(stream, file);
    case 'literal': return parseLiteralType(stream, file);
    case 'lazy': {
      stream.expect('LPAREN');
      const inner = parseTypeExpression(stream, file);
      stream.expect('RPAREN');
      return { kind: 'lazy', inner };
    }
  }

  // Scalars
  const scalarNames = ['string','number','int','bigint','boolean','date','datetime',
    'email','url','uuid','any','unknown','null','object','binary'];

  if (scalarNames.includes(name)) {
    const scalar: ScalarTypeNode = { kind: 'scalar', name: name as ScalarTypeNode['name'] };
    if (stream.peek().kind === 'LPAREN') {
      parseScalarModifiers(stream, scalar);
    }
    return scalar;
  }

  // Model reference
  return { kind: 'ref', name };
}

function parseScalarModifiers(stream: TokenStream, scalar: ScalarTypeNode): void {
  stream.consume(); // LPAREN
  // Parse comma-separated key=value pairs
  while (stream.peek().kind !== 'RPAREN' && stream.peek().kind !== 'EOF') {
    const key = stream.consume().value;
    if (stream.peek().kind === 'EQUALS') {
      stream.consume();
      if (key === 'regex') {
        // Consume regex: /pattern/
        stream.match('SLASH');
        let pattern = '';
        while (stream.peek().kind !== 'SLASH' && stream.peek().kind !== 'RPAREN' && stream.peek().kind !== 'EOF') {
          pattern += stream.consume().value;
        }
        stream.match('SLASH');
        scalar.regex = pattern;
      } else {
        const val = stream.consume();
        const num = Number(val.value);
        if (key === 'min') scalar.min = scalar.name === 'bigint' ? BigInt(val.value) : num;
        if (key === 'max') scalar.max = scalar.name === 'bigint' ? BigInt(val.value) : num;
        if (key === 'len' || key === 'length') scalar.len = num;
      }
    }
    stream.match('COMMA');
  }
  stream.match('RPAREN');
}

function parseArrayType(stream: TokenStream, file: string): ArrayTypeNode {
  stream.expect('LPAREN');
  const item = parseSingleType(stream, file);
  let min: number | undefined;
  let max: number | undefined;
  while (stream.peek().kind === 'COMMA') {
    stream.consume();
    if (stream.peek().kind === 'RPAREN') break;
    const key = stream.consume().value;
    stream.expect('EQUALS');
    const val = Number(stream.consume().value);
    if (key === 'min') min = val;
    if (key === 'max') max = val;
  }
  stream.expect('RPAREN');
  return { kind: 'array', item, min, max };
}

function parseTupleType(stream: TokenStream, file: string): TupleTypeNode {
  stream.expect('LPAREN');
  const items: DtoTypeNode[] = [];
  while (stream.peek().kind !== 'RPAREN' && stream.peek().kind !== 'EOF') {
    items.push(parseSingleType(stream, file));
    stream.match('COMMA');
  }
  stream.expect('RPAREN');
  return { kind: 'tuple', items };
}

function parseRecordType(stream: TokenStream, file: string): RecordTypeNode {
  stream.expect('LPAREN');
  const key = parseSingleType(stream, file);
  stream.expect('COMMA');
  const value = parseSingleType(stream, file);
  stream.expect('RPAREN');
  return { kind: 'record', key, value };
}

function parseEnumType(stream: TokenStream, file: string): EnumTypeNode {
  stream.expect('LPAREN');
  const values: string[] = [];
  while (stream.peek().kind !== 'RPAREN' && stream.peek().kind !== 'EOF') {
    values.push(stream.consume().value);
    stream.match('COMMA');
  }
  stream.expect('RPAREN');
  return { kind: 'enum', values };
}

function parseLiteralType(stream: TokenStream, _file: string): LiteralTypeNode {
  stream.expect('LPAREN');
  const tok = stream.consume();
  let value: string | number | boolean;
  if (tok.kind === 'STRING') value = tok.value;
  else if (tok.kind === 'NUMBER') value = Number(tok.value);
  else if (tok.kind === 'BOOLEAN') value = tok.value === 'true';
  else value = tok.value;
  stream.expect('RPAREN');
  return { kind: 'literal', value };
}

function parseInlineBraceObject(stream: TokenStream, file: string): InlineObjectTypeNode {
  stream.consume(); // LBRACE
  const fields: FieldNode[] = [];
  while (stream.peek().kind !== 'RBRACE' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'RBRACE') break;
    const field = parseField(stream, file);
    if (field) fields.push(field);
    stream.match('COMMA');
  }
  stream.expect('RBRACE');
  return { kind: 'inlineObject', fields };
}
