import type { ModelNode } from '@maroonedsoftware/contractkit';
import { printField, printInlineObjectExpanded, extractTrailingInlineObject, printType } from './print-type.js';

const INDENT = '    ';

// ─── Model declaration ───────────────────────────────────────────────────────

export function printModelDecl(model: ModelNode): string {
  // Type alias form: Name : typeExpression
  if (model.type !== undefined) {
    return printTypeAlias(model);
  }

  // Regular model with fields (possibly inherited)
  const commentSuffix = model.description ? ` # ${model.description}` : '';
  const modifiers = [model.parseCase ? `parse(${model.parseCase})` : '', model.mode ? `mode(${model.mode})` : ''].filter(Boolean).join(' ');
  const modePrefix = modifiers ? `${modifiers} ` : '';
  const header = model.base ? `${modePrefix}${model.name}: ${model.base} & {${commentSuffix}` : `${modePrefix}${model.name}: {${commentSuffix}`;

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
  const modifiers = [model.parseCase ? `parse(${model.parseCase})` : '', model.mode ? `mode(${model.mode})` : ''].filter(Boolean).join(' ');
  const modePrefix = modifiers ? `${modifiers} ` : '';

  // If the type ends with an inline brace object, expand it as a pseudo-model block.
  const trailing = extractTrailingInlineObject(type);
  if (trailing) {
    const { prefix, inlineObj } = trailing;
    const modePart = inlineObj.mode ? `mode(${inlineObj.mode}) ` : '';
    const header = prefix
      ? `${modePrefix}${model.name}: ${prefix} & ${modePart}{${commentSuffix}`
      : `${modePrefix}${model.name}: ${modePart}{${commentSuffix}`;
    const lines: string[] = [header, ...printInlineObjectExpanded(inlineObj, INDENT), '}'];
    return lines.join('\n');
  }

  // Simple type alias — single line.
  return `${modePrefix}${model.name}: ${printType(type)}${commentSuffix}`;
}
