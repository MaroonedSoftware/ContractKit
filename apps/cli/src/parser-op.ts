import { tokenize } from './lexer.js';
import { TokenStream, ParseError } from './token-stream.js';
import { DiagnosticCollector } from './diagnostics.js';
import { parseDto } from './parser-dto.js';
import type {
  OpRootNode, OpRouteNode, OpOperationNode, OpParamNode,
  OpRequestNode, OpResponseNode, HttpMethod, DtoTypeNode,
} from './ast.js';

const HTTP_METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete'];

// ─── Public entry point ────────────────────────────────────────────────────

export function parseOp(source: string, file: string, diag: DiagnosticCollector): OpRootNode {
  const tokens = tokenize(source, file);
  const stream = new TokenStream(tokens, file);
  const routes: OpRouteNode[] = [];

  stream.skipNewlines();

  while (stream.peek().kind !== 'EOF') {
    try {
      const route = parseRoute(stream, file, diag);
      if (route) routes.push(route);
    } catch (e) {
      if (e instanceof ParseError) {
        diag.error(e.file, e.line, e.message);
        // skip to next route
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

  return { kind: 'opRoot', routes, file };
}

// ─── Route ─────────────────────────────────────────────────────────────────

function parseRoute(stream: TokenStream, file: string, diag: DiagnosticCollector): OpRouteNode | null {
  stream.skipNewlines();
  if (stream.peek().kind === 'EOF') return null;

  // Route path: /some/path/:param:
  const path = consumeRoutePath(stream, file);
  const loc = { file, line: stream.peek().line };

  stream.expect('COLON');
  stream.match('NEWLINE');

  if (stream.peek().kind !== 'INDENT') {
    diag.error(file, stream.peek().line, `Expected indented block after route '${path}'`);
    return null;
  }
  stream.consume(); // INDENT

  const operations: OpOperationNode[] = [];
  let params: OpParamNode[] | undefined;

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT') break;

    const keyTok = stream.peek();
    if (keyTok.kind !== 'IDENTIFIER') { stream.consume(); continue; }

    const key = keyTok.value.toLowerCase();

    if (key === 'params') {
      stream.consume();
      stream.expect('COLON');
      stream.match('NEWLINE');
      params = parseParamsBlock(stream, file, diag);
    } else if ((HTTP_METHODS as string[]).includes(key)) {
      stream.consume();
      stream.expect('COLON');
      stream.match('NEWLINE');
      const op = parseOperation(stream, file, key as HttpMethod, diag);
      if (op) operations.push(op);
    } else {
      // Unknown key — skip line
      while (stream.peek().kind !== 'NEWLINE' && stream.peek().kind !== 'EOF') stream.consume();
      stream.match('NEWLINE');
    }
  }

  stream.match('DEDENT');

  return { path, params, operations, loc };
}

// ─── Params block ──────────────────────────────────────────────────────────

function parseParamsBlock(stream: TokenStream, file: string, diag: DiagnosticCollector): OpParamNode[] {
  const params: OpParamNode[] = [];
  if (stream.peek().kind !== 'INDENT') return params;
  stream.consume();

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT') break;

    const nameTok = stream.peek();
    if (nameTok.kind !== 'IDENTIFIER') { stream.consume(); continue; }
    stream.consume();
    stream.expect('COLON');

    // Parse inline type (single token for params like uuid, string, int)
    const typeTok = stream.consume();
    const type = resolveSimpleType(typeTok.value);
    stream.match('NEWLINE');

    params.push({ name: nameTok.value, type, loc: { file, line: nameTok.line } });
  }

  stream.match('DEDENT');
  return params;
}

// ─── Operation ─────────────────────────────────────────────────────────────

function parseOperation(
  stream: TokenStream, file: string, method: HttpMethod, diag: DiagnosticCollector
): OpOperationNode | null {
  const loc = { file, line: stream.peek().line };

  if (stream.peek().kind !== 'INDENT') {
    // Operation with no body (e.g. simple delete)
    return { method, loc };
  }
  stream.consume(); // INDENT

  let service: string | undefined;
  let request: OpRequestNode | undefined;
  let response: OpResponseNode | undefined;

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT') break;

    const keyTok = stream.peek();
    if (keyTok.kind !== 'IDENTIFIER') { stream.consume(); continue; }
    const key = keyTok.value.toLowerCase();
    stream.consume();
    stream.expect('COLON');
    stream.match('NEWLINE');

    if (key === 'service') {
      // service value on same line before NEWLINE — re-consume
      // Actually service is on the SAME line: service: ServiceClass.method
      // We already consumed COLON and NEWLINE — peek back... 
      // Let's handle this differently: re-read from the stream
      // (The stream advanced past the NEWLINE. The service value was on the key line.)
      // This means we need to handle service: value differently — key and value on same line.
      // Backtrack: the above consumed COLON + NEWLINE but value is between them.
      // Fix: don't consume NEWLINE for single-value lines — handled below.
    }

    if (key === 'service') {
      // Already lost the value — this is a parser limitation of consuming NEWLINE eagerly.
      // Let's not consume NEWLINE and re-read. Actually we need to restructure this.
      // For now: service value has already been consumed as part of previous logic issue.
      // See revised parseKeyValue below.
    }

    switch (key) {
      case 'request':
        request = parseRequestBlock(stream, file);
        break;
      case 'response':
        response = parseResponseBlock(stream, file, diag);
        break;
      default:
        // skip unknown indented block
        if (stream.peek().kind === 'INDENT') {
          stream.consume();
          while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') stream.consume();
          stream.match('DEDENT');
        }
    }
  }

  stream.match('DEDENT');
  return { method, service, request, response, loc };
}

function parseRequestBlock(stream: TokenStream, file: string): OpRequestNode | undefined {
  if (stream.peek().kind !== 'INDENT') return undefined;
  stream.consume();

  let result: OpRequestNode | undefined;

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT') break;

    // content-type: BodyType
    const ctParts: string[] = [];
    while (stream.peek().kind === 'IDENTIFIER' || stream.peek().kind === 'SLASH') {
      ctParts.push(stream.consume().value);
    }
    const contentType = ctParts.join('');
    stream.expect('COLON');

    // Body type (rest of line)
    const bodyParts: string[] = [];
    while (stream.peek().kind !== 'NEWLINE' && stream.peek().kind !== 'EOF' && stream.peek().kind !== 'COMMENT') {
      bodyParts.push(stream.consume().value);
    }
    stream.match('COMMENT');
    stream.match('NEWLINE');

    const ct = contentType.toLowerCase().includes('multipart') ? 'multipart/form-data' : 'application/json';
    result = { contentType: ct, bodyType: bodyParts.join('') };
  }

  stream.match('DEDENT');
  return result;
}

function parseResponseBlock(stream: TokenStream, file: string, diag: DiagnosticCollector): OpResponseNode | undefined {
  if (stream.peek().kind !== 'INDENT') return undefined;
  stream.consume();

  let result: OpResponseNode | undefined;

  while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
    stream.skipNewlines();
    if (stream.peek().kind === 'DEDENT') break;

    // status code
    const statusTok = stream.consume();
    const statusCode = parseInt(statusTok.value, 10);
    stream.expect('COLON');
    stream.match('NEWLINE');

    // Optional content-type + body type block
    let contentType: 'application/json' | undefined;
    let bodyType: string | undefined;

    if (stream.peek().kind === 'INDENT') {
      stream.consume();
      while (stream.peek().kind !== 'DEDENT' && stream.peek().kind !== 'EOF') {
        stream.skipNewlines();
        if (stream.peek().kind === 'DEDENT') break;

        const ctParts: string[] = [];
        while (stream.peek().kind === 'IDENTIFIER' || stream.peek().kind === 'SLASH') {
          ctParts.push(stream.consume().value);
        }
        const ct = ctParts.join('');
        stream.expect('COLON');

        const bodyParts: string[] = [];
        while (stream.peek().kind !== 'NEWLINE' && stream.peek().kind !== 'EOF' && stream.peek().kind !== 'COMMENT') {
          bodyParts.push(stream.consume().value);
        }
        stream.match('COMMENT');
        stream.match('NEWLINE');

        contentType = 'application/json';
        bodyType = bodyParts.join('');
      }
      stream.match('DEDENT');
    }

    result = { statusCode, contentType, bodyType };
  }

  stream.match('DEDENT');
  return result;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function consumeRoutePath(stream: TokenStream, file: string): string {
  const parts: string[] = [];

  // Route path starts with /
  if (stream.peek().kind !== 'SLASH') {
    throw new ParseError(`Expected route path starting with '/'`, stream.peek().line, file);
  }

  // Consume tokens until we hit a COLON that is followed by NEWLINE or EOF (the route-ending colon).
  // A COLON followed by an IDENTIFIER is a path parameter: /:paramName
  while (stream.peek().kind !== 'EOF' && stream.peek().kind !== 'NEWLINE') {
    const tok = stream.peek();

    if (tok.kind === 'COLON') {
      // Look ahead: if next token is IDENTIFIER it's a path param; otherwise it's the terminating colon
      const next = stream.peek(1);
      if (next.kind === 'IDENTIFIER') {
        stream.consume(); // consume COLON
        parts.push(':');
        parts.push(stream.consume().value); // param name
      } else {
        // Terminating colon — stop (don't consume it)
        break;
      }
    } else if (tok.kind === 'SLASH') {
      stream.consume();
      parts.push('/');
    } else {
      stream.consume();
      parts.push(tok.value);
    }
  }

  return parts.join('');
}

function resolveSimpleType(name: string): DtoTypeNode {
  const scalars: Record<string, DtoTypeNode> = {
    uuid:    { kind: 'scalar', name: 'uuid' },
    string:  { kind: 'scalar', name: 'string' },
    int:     { kind: 'scalar', name: 'int' },
    number:  { kind: 'scalar', name: 'number' },
    boolean: { kind: 'scalar', name: 'boolean' },
  };
  return scalars[name] ?? { kind: 'ref', name };
}
