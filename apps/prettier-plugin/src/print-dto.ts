import type { DtoRootNode, ModelNode } from 'contract-dsl/src/ast.js';
import {
  printField,
  printInlineObjectExpanded,
  extractTrailingInlineObject,
  printType,
} from './print-type.js';

const INDENT = '    ';

// ─── Orphan comment helpers ──────────────────────────────────────────────────

type CommentEntry = { line: number; text: string };
type CommentBlock = { startLine: number; lines: string[] };

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

function flushBlocks(
  out: string[],
  blocks: CommentBlock[],
  idx: { value: number },
  beforeLine: number,
) {
  while (idx.value < blocks.length && blocks[idx.value]!.startLine < beforeLine) {
    for (const l of blocks[idx.value]!.lines) out.push(l);
    idx.value++;
  }
}

// ─── DTO file printer ────────────────────────────────────────────────────────

export function printDto(ast: DtoRootNode): string {
  const parts: string[] = [];
  const blocks = groupComments(ast.orphanComments ?? []);
  const idx = { value: 0 };

  if (Object.keys(ast.meta).length > 0) {
    parts.push(printFrontMatter(ast.meta));
  }

  for (const model of ast.models) {
    const pending: string[] = [];
    flushBlocks(pending, blocks, idx, model.loc.line);
    for (const l of pending) { if (parts.length > 0 || l) parts.push(l); }

    if (parts.length > 0) parts.push('');
    parts.push(printModelDecl(model));
  }

  // Emit remaining blocks after the last model
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
  // Values starting with # or containing spaces need quoting.
  if (value.startsWith('#') || value.includes(' ')) return `"${value}"`;
  return value;
}

// ─── Model declaration ───────────────────────────────────────────────────────

function printModelDecl(model: ModelNode): string {
  // Type alias form: Name : typeExpression
  if (model.type !== undefined) {
    return printTypeAlias(model);
  }

  // Regular model with fields (possibly inherited)
  const commentSuffix = model.description ? ` # ${model.description}` : '';
  const header = model.base
    ? `${model.name}: ${model.base} {${commentSuffix}`
    : `${model.name}: {${commentSuffix}`;

  const lines: string[] = [header];
  for (const field of model.fields) {
    lines.push(printField(field, INDENT));
  }
  lines.push('}');
  return lines.join('\n');
}

function printTypeAlias(model: ModelNode): string {
  const type = model.type!;
  const commentSuffix = model.description ? ` # ${model.description}` : '';

  // If the type ends with an inline brace object, expand it as a pseudo-model block.
  const trailing = extractTrailingInlineObject(type);
  if (trailing) {
    const { prefix, inlineObj } = trailing;
    const header = prefix
      ? `${model.name}: ${prefix} & {${commentSuffix}`
      : `${model.name}: {${commentSuffix}`;
    const lines: string[] = [header, ...printInlineObjectExpanded(inlineObj, INDENT), '}'];
    return lines.join('\n');
  }

  // Simple type alias — single line.
  return `${model.name}: ${printType(type)}${commentSuffix}`;
}
