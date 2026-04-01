import { Hover, MarkupKind, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';
import type { ContractTypeNode, FieldNode, ModelNode } from '@maroonedsoftware/contractkit';

const SECURITY_SCHEME_DOCS: Record<string, string> = {
    bearer: 'Bearer token authentication\n\nAdds an `Authorization: Bearer <token>` header. Resolved at runtime via `securityHandler` in `SdkOptions`.',
    apiKey: 'API key authentication\n\nKey passed via a named header, query parameter, or cookie.\n\n```op\nsecurity: apiKey(header="X-API-Key")\nsecurity: apiKey(query="api_key")\n```',
    none: 'No authentication required\n\nMarks the endpoint as public, explicitly overriding any global `security` default.',
};

const BUILTIN_TYPE_DOCS: Record<string, string> = {
    string: 'Text string — Zod `z.string()`',
    number: 'Floating-point number — Zod `z.coerce.number()`',
    int: 'Integer number — Zod `z.coerce.number().int()`',
    bigint: 'BigInt — Zod `z.bigint()`',
    boolean: 'Boolean true/false — Zod `z.boolean()`',
    date: 'Date — Luxon `DateTime` custom validator',
    time: 'Time — Luxon `DateTime` custom validator',
    datetime: 'ISO 8601 datetime — Luxon `DateTime` custom validator',
    email: 'Email address — Zod `z.email()`',
    url: 'URL string — Zod `z.url()`',
    uuid: 'UUID string — Zod `z.uuid()`',
    unknown: 'Unknown value — Zod `z.unknown()`',
    null: 'Null literal — Zod `z.null()`',
    object: 'Generic object — Zod `z.record(z.string(), z.unknown())`',
    binary: 'Binary data — `Buffer` custom validator',
    json: 'Any JSON value — recursive `z.lazy()` union of primitives, arrays, and objects',
};

export function getHover(params: TextDocumentPositionParams, document: TextDocument, index: WorkspaceIndex): Hover | null {
    const word = getWordAtPosition(document, params.position.line, params.position.character);
    if (!word) return null;

    // Check security scheme keywords
    if (word in SECURITY_SCHEME_DOCS) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${word}**\n\n${SECURITY_SCHEME_DOCS[word]}`,
            },
        };
    }

    // Check built-in types
    if (word in BUILTIN_TYPE_DOCS) {
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: `**${word}**\n\n${BUILTIN_TYPE_DOCS[word]}`,
            },
        };
    }

    // Check model references
    const modelEntry = index.getModel(word);
    if (modelEntry) {
        const md = formatModelHover(modelEntry.model);
        return {
            contents: {
                kind: MarkupKind.Markdown,
                value: md,
            },
        };
    }

    return null;
}

function formatModelHover(model: ModelNode): string {
    const lines: string[] = [];
    lines.push(`**${model.name}**`);
    if (model.base) lines.push(`extends \`${model.base}\``);
    if (model.description) lines.push(`\n${model.description}`);
    lines.push('');
    lines.push('```ck');
    lines.push(`contract ${model.name}${model.base ? `: ${model.base} & ` : ': '}{`);
    for (const field of model.fields) {
        lines.push(`    ${formatField(field)}`);
    }
    lines.push('}');
    lines.push('```');
    return lines.join('\n');
}

function formatField(field: FieldNode): string {
    const parts: string[] = [];
    parts.push(field.name);
    if (field.optional) parts.push('?');
    parts.push(':');
    if (field.visibility !== 'normal') parts.push(` ${field.visibility}`);
    parts.push(` ${formatType(field.type)}`);
    if (field.default !== undefined) parts.push(` = ${JSON.stringify(field.default)}`);
    return parts.join('');
}

function formatType(type: ContractTypeNode): string {
    switch (type.kind) {
        case 'scalar': {
            const constraints: string[] = [];
            if (type.min !== undefined) constraints.push(`min=${String(type.min)}`);
            if (type.max !== undefined) constraints.push(`max=${String(type.max)}`);
            if (type.len !== undefined) constraints.push(`length=${type.len}`);
            if (type.regex) constraints.push(`regex=${type.regex}`);
            return constraints.length > 0 ? `${type.name}(${constraints.join(', ')})` : type.name;
        }
        case 'array':
            return `array(${formatType(type.item)})`;
        case 'tuple':
            return `tuple(${type.items.map(formatType).join(', ')})`;
        case 'record':
            return `record(${formatType(type.key)}, ${formatType(type.value)})`;
        case 'enum':
            return `enum(${type.values.join(', ')})`;
        case 'literal':
            return JSON.stringify(type.value);
        case 'union':
            return type.members.map(formatType).join(' | ');
        case 'intersection':
            return type.members.map(formatType).join(' & ');
        case 'ref':
            return type.name;
        case 'inlineObject':
            return `{ ${type.fields.map(formatField).join(', ')} }`;
        case 'lazy':
            return `lazy(${formatType(type.inner)})`;
    }
}

function getWordAtPosition(document: TextDocument, line: number, character: number): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    if (line >= lines.length) return null;

    const lineText = lines[line]!;
    if (character >= lineText.length) return null;

    let start = character;
    while (start > 0 && /[a-zA-Z0-9_$]/.test(lineText[start - 1]!)) {
        start--;
    }
    let end = character;
    while (end < lineText.length && /[a-zA-Z0-9_$]/.test(lineText[end]!)) {
        end++;
    }

    if (start === end) return null;
    return lineText.slice(start, end);
}
