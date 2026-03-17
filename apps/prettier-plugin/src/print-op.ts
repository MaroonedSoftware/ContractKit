import type {
  OpRootNode,
  OpRouteNode,
  OpOperationNode,
  OpResponseNode,
  OpParamNode,
  ParamSource,
  SecurityNode,
  SecurityFields,
  DtoTypeNode,
  ObjectMode,
} from 'contract-dsl/src/ast.js';
import { SECURITY_NONE } from 'contract-dsl/src/ast.js';
import { printType, formatDefault } from './print-type.js';

const I1 = '    ';
const I2 = '        ';
const I3 = '            ';
const I4 = '                ';

// ─── Orphan comment helpers ──────────────────────────────────────────────────

type CommentEntry = { line: number; text: string };
type CommentBlock = { startLine: number; lines: string[] };

/** Group sorted orphan comment entries into consecutive-line blocks. */
function groupComments(entries: CommentEntry[]): CommentBlock[] {
  const blocks: CommentBlock[] = [];
  let current: CommentBlock | null = null;
  for (const { line, text } of entries) {
    if (current && line === current.startLine + current.lines.length) {
      current.lines.push(`#${text}`);
    } else {
      if (current) blocks.push(current);
      current = { startLine: line, lines: [`#${text}`] };
    }
  }
  if (current) blocks.push(current);
  return blocks;
}

/**
 * Emit any comment blocks whose startLine is < beforeLine.
 * Prepends `indent` to each comment line (use '' for top-level, I1 for inside a route).
 */
function flushBlocks(
  out: string[],
  blocks: CommentBlock[],
  idx: { value: number },
  beforeLine: number,
  indent = '',
) {
  while (idx.value < blocks.length && blocks[idx.value]!.startLine < beforeLine) {
    for (const l of blocks[idx.value]!.lines) out.push(`${indent}${l}`);
    idx.value++;
  }
}

// ─── OP file printer ────────────────────────────────────────────────────────

export function printOp(ast: OpRootNode): string {
  const parts: string[] = [];
  const blocks = groupComments(ast.orphanComments ?? []);
  const idx = { value: 0 };

  if (Object.keys(ast.meta).length > 0) {
    parts.push(printFrontMatter(ast.meta));
  }

  if (ast.security !== undefined) {
    if (parts.length > 0) parts.push('');
    parts.push(...printSecurity(ast.security, '', I1));
  }

  for (let i = 0; i < ast.routes.length; i++) {
    const route = ast.routes[i]!;
    const nextRouteStart = ast.routes[i + 1]?.loc.line ?? Infinity;

    // Emit orphan blocks that appear before this route
    const pending: string[] = [];
    flushBlocks(pending, blocks, idx, route.loc.line);
    for (const l of pending) { if (parts.length > 0 || l) parts.push(l); }

    if (parts.length > 0) parts.push('');
    parts.push(printRoute(route, blocks, idx, nextRouteStart));
  }

  // Emit any remaining blocks after the last route
  const trailing: string[] = [];
  flushBlocks(trailing, blocks, idx, Infinity);
  for (const l of trailing) { parts.push(''); parts.push(l); }

  return parts.join('\n') + '\n';
}

// ─── Front matter ────────────────────────────────────────────────────────────

function printFrontMatter(meta: Record<string, string>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(meta)) {
    lines.push(`${key}: ${printMetaValue(value)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function printMetaValue(value: string): string {
  if (value.startsWith('#') || value.includes(' ')) return `"${value}"`;
  return value;
}

// ─── Route ───────────────────────────────────────────────────────────────────

function printRoute(
  route: OpRouteNode,
  blocks: CommentBlock[],
  idx: { value: number },
  nextRouteStart: number,
): string {
  const lines: string[] = [];
  const commentSuffix = route.description ? ` # ${route.description}` : '';
  const modifiersPart = route.modifiers?.length ? `: ${route.modifiers.join(' ')}` : '';
  lines.push(`${route.path}${modifiersPart} {${commentSuffix}`);

  if (route.params !== undefined) {
    lines.push(...printParamsBlock(route.params, I1, route.paramsMode));
  }

  if (route.security !== undefined) {
    lines.push(...printSecurity(route.security, I1, I2));
  }

  for (const op of route.operations) {
    // Flush comment blocks that appear before this operation (inside the route)
    flushBlocks(lines, blocks, idx, op.loc.line, I1);
    lines.push(...printOperation(op));
  }

  // Flush comment blocks between last operation and the next route
  flushBlocks(lines, blocks, idx, nextRouteStart, I1);

  lines.push('}');
  return lines.join('\n');
}

// ─── Params block ────────────────────────────────────────────────────────────

function printParamsBlock(source: ParamSource, indent: string, mode?: ObjectMode): string[] {
  const prefix = mode ? `${mode} ` : '';
  if (typeof source === 'string') {
    return [`${indent}${prefix}params: ${source}`];
  }
  if (Array.isArray(source)) {
    const lines: string[] = [`${indent}${prefix}params: {`];
    const inner = indent + '    ';
    for (const p of source) {
      const comment = p.description ? ` # ${p.description}` : '';
      lines.push(`${inner}${p.name}: ${printType(p.type)}${comment}`);
    }
    lines.push(`${indent}}`);
    return lines;
  }
  // DtoTypeNode
  return [`${indent}${prefix}params: ${printType(source)}`];
}

// ─── HTTP operation ──────────────────────────────────────────────────────────

function printOperation(op: OpOperationNode): string[] {
  const lines: string[] = [];
  const commentSuffix = op.description ? ` # ${op.description}` : '';
  const modifiersPart = op.modifiers?.length ? ` ${op.modifiers.join(' ')}` : '';
  lines.push(`${I1}${op.method}:${modifiersPart} {${commentSuffix}`);

  if (op.service) lines.push(`${I2}service: ${op.service}`);
  if (op.sdk) lines.push(`${I2}sdk: ${op.sdk}`);
  if (op.signature) {
    const comment = op.signatureDescription ? ` # ${op.signatureDescription}` : '';
    lines.push(`${I2}signature: ${formatSignatureValue(op.signature)}${comment}`);
  }
  if (op.security !== undefined) lines.push(...printSecurity(op.security));
  if (op.query !== undefined) lines.push(...printQueryOrHeaders('query', op.query, op.queryMode));
  if (op.headers !== undefined) lines.push(...printQueryOrHeaders('headers', op.headers, op.headersMode));
  if (op.request) {
    lines.push(`${I2}request: {`);
    lines.push(...printContentTypeLine(op.request.contentType, op.request.bodyType, I3));
    lines.push(`${I2}}`);
  }
  if (op.responses.length > 0) {
    lines.push(...printResponseBlock(op.responses));
  }

  lines.push(`${I1}}`);
  return lines;
}

// ─── Security ────────────────────────────────────────────────────────────────

/** Print a signature key: unquoted when it's a plain identifier, quoted otherwise. */
function formatSignatureValue(value: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(value) ? value : `"${value}"`;
}

// indent: indentation for the `security` keyword line
// innerIndent: indentation for field lines inside the block
function printSecurity(security: SecurityNode, indent = I2, innerIndent = I3): string[] {
  if (security === SECURITY_NONE) return [`${indent}security: none`];
  const fields = security as SecurityFields;
  const hasRoles = fields.roles && fields.roles.length > 0;
  if (!hasRoles) return [];
  const lines = [`${indent}security: {`];
  const comment = fields.rolesDescription ? ` # ${fields.rolesDescription}` : '';
  lines.push(`${innerIndent}roles: ${fields.roles!.join(' ')}${comment}`);
  lines.push(`${indent}}`);
  return lines;
}

// ─── Query / headers ─────────────────────────────────────────────────────────

function printQueryOrHeaders(keyword: 'query' | 'headers', source: ParamSource, mode?: ObjectMode): string[] {
  const prefix = mode ? `${mode} ` : '';
  if (typeof source === 'string') {
    return [`${I2}${prefix}${keyword}: ${source}`];
  }
  if (Array.isArray(source)) {
    if (source.length === 0) return [];
    const lines: string[] = [`${I2}${prefix}${keyword}: {`];
    for (const p of source) {
      const comment = p.description ? ` # ${p.description}` : '';
      lines.push(`${I3}${p.name}: ${printType(p.type)}${comment}`);
    }
    lines.push(`${I2}}`);
    return lines;
  }
  // DtoTypeNode (e.g. intersection)
  return [`${I2}${prefix}${keyword}: ${printType(source as DtoTypeNode)}`];
}

// ─── Content-type line ───────────────────────────────────────────────────────

/** Print a `contentType: bodyType` line, expanding inline brace objects onto separate lines. */
function printContentTypeLine(contentType: string, bodyType: DtoTypeNode, lineIndent: string): string[] {
  if (bodyType.kind === 'inlineObject') {
    const fieldIndent = lineIndent + '    ';
    const lines: string[] = [`${lineIndent}${contentType}: {`];
    for (const f of bodyType.fields) {
      const opt = f.optional ? '?' : '';
      let t = printType(f.type);
      if (f.nullable) t += ' | null';
      const def = f.default !== undefined ? ` = ${formatDefault(f.default)}` : '';
      const comment = f.description ? ` # ${f.description}` : '';
      lines.push(`${fieldIndent}${f.name}${opt}: ${t}${def}${comment}`);
    }
    lines.push(`${lineIndent}}`);
    return lines;
  }
  return [`${lineIndent}${contentType}: ${printType(bodyType)}`];
}

// ─── Response block ──────────────────────────────────────────────────────────

function printResponseBlock(responses: OpResponseNode[]): string[] {
  const lines: string[] = [`${I2}response: {`];

  for (const resp of responses) {
    if (resp.contentType && resp.bodyType) {
      lines.push(`${I3}${resp.statusCode}: {`);
      lines.push(...printContentTypeLine(resp.contentType, resp.bodyType, I4));
      lines.push(`${I3}}`);
    } else {
      lines.push(`${I3}${resp.statusCode}:`);
    }
  }

  lines.push(`${I2}}`);
  return lines;
}
