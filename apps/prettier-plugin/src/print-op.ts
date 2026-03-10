import type {
  OpRootNode,
  OpRouteNode,
  OpOperationNode,
  OpResponseNode,
  OpParamNode,
  ParamSource,
  SecurityNode,
  DtoTypeNode,
} from 'contract-dsl/src/ast.js';
import { printType } from './print-type.js';

const I1 = '    ';
const I2 = '        ';
const I3 = '            ';
const I4 = '                ';

// ─── OP file printer ────────────────────────────────────────────────────────

export function printOp(ast: OpRootNode): string {
  const parts: string[] = [];

  if (Object.keys(ast.meta).length > 0) {
    parts.push(printFrontMatter(ast.meta));
  }

  for (const route of ast.routes) {
    if (parts.length > 0) parts.push('');
    parts.push(printRoute(route));
  }

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

function printRoute(route: OpRouteNode): string {
  const lines: string[] = [];
  lines.push(`${route.path} {`);

  if (route.params !== undefined) {
    lines.push(...printParamsBlock(route.params, I1));
  }

  for (const op of route.operations) {
    lines.push(...printOperation(op));
  }

  lines.push('}');
  return lines.join('\n');
}

// ─── Params block ────────────────────────────────────────────────────────────

function printParamsBlock(source: ParamSource, indent: string): string[] {
  if (typeof source === 'string') {
    return [`${indent}params: ${source}`];
  }
  if (Array.isArray(source)) {
    const lines: string[] = [`${indent}params: {`];
    const inner = indent + '    ';
    for (const p of source) {
      lines.push(`${inner}${p.name}: ${printType(p.type)}`);
    }
    lines.push(`${indent}}`);
    return lines;
  }
  // DtoTypeNode
  return [`${indent}params: ${printType(source)}`];
}

// ─── HTTP operation ──────────────────────────────────────────────────────────

function printOperation(op: OpOperationNode): string[] {
  const lines: string[] = [];
  lines.push(`${I1}${op.method}: {`);

  if (op.service) lines.push(`${I2}service: ${op.service}`);
  if (op.sdk) lines.push(`${I2}sdk: ${op.sdk}`);
  if (op.security) lines.push(`${I2}security: ${printSecurity(op.security)}`);
  if (op.query !== undefined) lines.push(...printQueryOrHeaders('query', op.query));
  if (op.headers !== undefined) lines.push(...printQueryOrHeaders('headers', op.headers));
  if (op.request) {
    lines.push(`${I2}request: {`);
    lines.push(`${I3}${op.request.contentType}: ${printType(op.request.bodyType)}`);
    lines.push(`${I2}}`);
  }
  if (op.responses.length > 0) {
    lines.push(...printResponseBlock(op.responses));
  }

  lines.push(`${I1}}`);
  return lines;
}

// ─── Security ────────────────────────────────────────────────────────────────

function printSecurity(security: SecurityNode): string {
  return security.map(scheme => {
    const args: string[] = [];
    for (const [key, val] of Object.entries(scheme.params)) {
      args.push(`${key}="${val}"`);
    }
    for (const scope of scheme.scopes) {
      args.push(`"${scope}"`);
    }
    return args.length > 0 ? `${scheme.name}(${args.join(', ')})` : scheme.name;
  }).join(' | ');
}

// ─── Query / headers ─────────────────────────────────────────────────────────

function printQueryOrHeaders(keyword: 'query' | 'headers', source: ParamSource): string[] {
  if (typeof source === 'string') {
    return [`${I2}${keyword}: ${source}`];
  }
  if (Array.isArray(source)) {
    if (source.length === 0) return [];
    const lines: string[] = [`${I2}${keyword}: {`];
    for (const p of source) {
      lines.push(`${I3}${p.name}: ${printType(p.type)}`);
    }
    lines.push(`${I2}}`);
    return lines;
  }
  // DtoTypeNode (e.g. intersection)
  return [`${I2}${keyword}: ${printType(source as DtoTypeNode)}`];
}

// ─── Response block ──────────────────────────────────────────────────────────

function printResponseBlock(responses: OpResponseNode[]): string[] {
  const lines: string[] = [`${I2}response: {`];

  for (const resp of responses) {
    if (resp.contentType && resp.bodyType) {
      lines.push(`${I3}${resp.statusCode}: {`);
      lines.push(`${I4}${resp.contentType}: ${printType(resp.bodyType)}`);
      lines.push(`${I3}}`);
    } else {
      lines.push(`${I3}${resp.statusCode}:`);
    }
  }

  lines.push(`${I2}}`);
  return lines;
}
