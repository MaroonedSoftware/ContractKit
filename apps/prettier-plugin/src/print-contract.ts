import type { ModelNode } from '@contractkit/core';
import { printField, printInlineObjectExpanded, extractTrailingInlineObject, printType, printEnumExpanded } from './print-type.js';
import { INDENT } from './indent.js';

// ─── Model declaration ───────────────────────────────────────────────────────

export function printModelDecl(model: ModelNode, printWidth: number = 80): string {
    // Type alias form: Name : typeExpression
    if (model.type !== undefined) {
        return printTypeAlias(model, printWidth);
    }

    // Regular model with fields (possibly inherited)
    const commentSuffix = model.description ? ` # ${model.description}` : '';
    const modifiers = [
        model.deprecated ? 'deprecated' : '',
        model.inputCase || model.outputCase
            ? `format(${[model.inputCase ? `input=${model.inputCase}` : '', model.outputCase ? `output=${model.outputCase}` : ''].filter(Boolean).join(', ')})`
            : '',
        model.mode ? `mode(${model.mode})` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const modePrefix = modifiers ? `${modifiers} ` : '';
    const header = model.base ? `${modePrefix}${model.name}: ${model.base} & {${commentSuffix}` : `${modePrefix}${model.name}: {${commentSuffix}`;

    const lines: string[] = [header];
    for (const field of model.fields) {
        lines.push(printField(field, INDENT, printWidth));
    }
    lines.push('}');
    return lines.join('\n');
}

function printTypeAlias(model: ModelNode, printWidth: number): string {
    const type = model.type!;
    const commentSuffix = model.description ? ` # ${model.description}` : '';
    const modifiers = [
        model.deprecated ? 'deprecated' : '',
        model.inputCase || model.outputCase
            ? `format(${[model.inputCase ? `input=${model.inputCase}` : '', model.outputCase ? `output=${model.outputCase}` : ''].filter(Boolean).join(', ')})`
            : '',
        model.mode ? `mode(${model.mode})` : '',
    ]
        .filter(Boolean)
        .join(' ');
    const modePrefix = modifiers ? `${modifiers} ` : '';

    // If the type ends with an inline brace object, expand it as a pseudo-model block.
    const trailing = extractTrailingInlineObject(type);
    if (trailing) {
        const { prefix, inlineObj } = trailing;
        const modePart = inlineObj.mode ? `mode(${inlineObj.mode}) ` : '';
        const header = prefix
            ? `${modePrefix}${model.name}: ${prefix} & ${modePart}{${commentSuffix}`
            : `${modePrefix}${model.name}: ${modePart}{${commentSuffix}`;
        const lines: string[] = [header, ...printInlineObjectExpanded(inlineObj, INDENT, printWidth), '}'];
        return lines.join('\n');
    }

    // Simple type alias — single line, unless it's a long enum.
    // Note: the contract prefix "contract " (9 chars) is prepended by the caller.
    const singleLine = `${modePrefix}${model.name}: ${printType(type)}${commentSuffix}`;
    if (type.kind === 'enum' && 'contract '.length + singleLine.length > printWidth) {
        return `${modePrefix}${model.name}: ${printEnumExpanded(type.values, '')}${commentSuffix}`;
    }
    return singleLine;
}
