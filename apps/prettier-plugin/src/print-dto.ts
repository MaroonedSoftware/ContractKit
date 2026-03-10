import type { DtoRootNode, ModelNode } from 'contract-dsl/src/ast.js';
import {
  printField,
  printInlineObjectExpanded,
  extractTrailingInlineObject,
  printType,
} from './print-type.js';

const INDENT = '    ';

// ─── DTO file printer ────────────────────────────────────────────────────────

export function printDto(ast: DtoRootNode): string {
  const parts: string[] = [];

  if (Object.keys(ast.meta).length > 0) {
    parts.push(printFrontMatter(ast.meta));
  }

  for (const model of ast.models) {
    if (parts.length > 0) parts.push('');
    parts.push(printModelDecl(model));
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
