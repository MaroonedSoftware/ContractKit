import {
    CompletionItem,
    CompletionItemKind,
    TextDocumentPositionParams,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';

const BUILTIN_SCALAR_TYPES = [
    'string', 'number', 'int', 'bigint', 'boolean',
    'date', 'datetime', 'email', 'url', 'uuid',
    'any', 'unknown', 'null', 'object', 'binary',
];

const COMPOUND_TYPES = ['array', 'tuple', 'record', 'enum', 'lazy'];

const CONSTRAINT_KEYS = ['min', 'max', 'length', 'len', 'regex'];

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const OP_BLOCK_KEYWORDS = ['service', 'query', 'headers', 'request', 'response'];

export function getCompletions(
    params: TextDocumentPositionParams,
    document: TextDocument,
    index: WorkspaceIndex,
): CompletionItem[] {
    const text = document.getText();
    const lines = text.split('\n');
    const line = params.position.line;
    const char = params.position.character;
    const uri = document.uri;

    if (line >= lines.length) return [];
    const lineText = lines[line]!;
    const textBefore = lineText.slice(0, char);

    const isDtoFile = uri.endsWith('.dto');

    if (isDtoFile) {
        return getDtoCompletions(textBefore, lines, line, index);
    }
    return getOpCompletions(textBefore, lines, line, index);
}

function getDtoCompletions(
    textBefore: string,
    lines: string[],
    line: number,
    index: WorkspaceIndex,
): CompletionItem[] {
    // After a colon in a field — offer types
    if (/:\s*(readonly\s+|writeonly\s+)?$/.test(textBefore) ||
        /:\s*(readonly\s+|writeonly\s+)?\w*$/.test(textBefore)) {
        return [
            ...BUILTIN_SCALAR_TYPES.map((t) => ({
                label: t,
                kind: CompletionItemKind.TypeParameter,
                detail: 'Built-in type',
            })),
            ...COMPOUND_TYPES.map((t) => ({
                label: t,
                kind: CompletionItemKind.TypeParameter,
                detail: 'Compound type',
                insertText: `${t}($1)`,
                insertTextFormat: 2, // Snippet
            })),
            ...index.getAllModelNames().map((name) => ({
                label: name,
                kind: CompletionItemKind.Class,
                detail: 'Model reference',
            })),
        ];
    }

    // After a pipe — union type continuation
    if (/\|\s*\w*$/.test(textBefore)) {
        return [
            ...BUILTIN_SCALAR_TYPES.map((t) => ({
                label: t,
                kind: CompletionItemKind.TypeParameter,
            })),
            { label: 'null', kind: CompletionItemKind.Keyword },
            ...index.getAllModelNames().map((name) => ({
                label: name,
                kind: CompletionItemKind.Class,
            })),
        ];
    }

    // Inside parentheses — offer constraint keys
    if (/\(\s*$/.test(textBefore) || /,\s*$/.test(textBefore) || /,\s*\w*$/.test(textBefore)) {
        // Check if we're inside type constraints (look back for a type name before paren)
        const inConstraints = isInsideTypeConstraints(lines, line, textBefore);
        if (inConstraints) {
            return CONSTRAINT_KEYS.map((k) => ({
                label: k,
                kind: CompletionItemKind.Property,
                detail: 'Type constraint',
                insertText: `${k}=`,
            }));
        }
    }

    // Inside a model body at start of line — offer field visibility or nothing
    if (/^\s*$/.test(textBefore) && isInsideBraces(lines, line)) {
        return [
            { label: 'readonly', kind: CompletionItemKind.Keyword, detail: 'Field visibility' },
            { label: 'writeonly', kind: CompletionItemKind.Keyword, detail: 'Field visibility' },
        ];
    }

    return [];
}

function getOpCompletions(
    textBefore: string,
    lines: string[],
    line: number,
    index: WorkspaceIndex,
): CompletionItem[] {
    const context = getOpContext(lines, line);

    // At route body level — offer HTTP methods and params
    if (context === 'route-body' && /^\s*\w*$/.test(textBefore)) {
        return [
            { label: 'params', kind: CompletionItemKind.Keyword },
            ...HTTP_METHODS.map((m) => ({
                label: m,
                kind: CompletionItemKind.Keyword,
                detail: `HTTP ${m.toUpperCase()}`,
            })),
        ];
    }

    // At operation body level — offer operation keywords
    if (context === 'operation-body' && /^\s*\w*$/.test(textBefore)) {
        return OP_BLOCK_KEYWORDS.map((k) => ({
            label: k,
            kind: CompletionItemKind.Keyword,
        }));
    }

    // After service: — offer service names
    if (/service\s*:\s*\w*$/.test(textBefore)) {
        return index.getAllServiceNames().map((name) => ({
            label: name,
            kind: CompletionItemKind.Function,
            detail: 'Service reference',
        }));
    }

    // After query: or headers: or params: — offer model names
    if (/(?:query|headers|params)\s*:\s*\w*$/.test(textBefore)) {
        return index.getAllModelNames().map((name) => ({
            label: name,
            kind: CompletionItemKind.Class,
            detail: 'Model reference',
        }));
    }

    // After content type colon — offer model names
    if (/(?:application\/json|multipart\/form-data)\s*:\s*\w*$/.test(textBefore)) {
        return [
            {
                label: 'array',
                kind: CompletionItemKind.TypeParameter,
                detail: 'Array type',
                insertText: 'array($1)',
                insertTextFormat: 2,
            },
            ...index.getAllModelNames().map((name) => ({
                label: name,
                kind: CompletionItemKind.Class,
                detail: 'Model reference',
            })),
        ];
    }

    // Inside request/response body — offer content types
    if (context === 'request-body' || context === 'status-code-body') {
        if (/^\s*\w*$/.test(textBefore)) {
            return [
                {
                    label: 'application/json',
                    kind: CompletionItemKind.Value,
                    insertText: 'application/json: ',
                },
                {
                    label: 'multipart/form-data',
                    kind: CompletionItemKind.Value,
                    insertText: 'multipart/form-data: ',
                },
            ];
        }
    }

    // Inside response body — offer status codes
    if (context === 'response-body' && /^\s*\d*$/.test(textBefore)) {
        return [
            { label: '200', kind: CompletionItemKind.Value, detail: 'OK' },
            { label: '201', kind: CompletionItemKind.Value, detail: 'Created' },
            { label: '204', kind: CompletionItemKind.Value, detail: 'No Content' },
            { label: '400', kind: CompletionItemKind.Value, detail: 'Bad Request' },
            { label: '401', kind: CompletionItemKind.Value, detail: 'Unauthorized' },
            { label: '403', kind: CompletionItemKind.Value, detail: 'Forbidden' },
            { label: '404', kind: CompletionItemKind.Value, detail: 'Not Found' },
            { label: '409', kind: CompletionItemKind.Value, detail: 'Conflict' },
            { label: '422', kind: CompletionItemKind.Value, detail: 'Unprocessable Entity' },
            { label: '500', kind: CompletionItemKind.Value, detail: 'Internal Server Error' },
        ];
    }

    return [];
}

type OpContext =
    | 'top-level'
    | 'route-body'
    | 'operation-body'
    | 'request-body'
    | 'response-body'
    | 'status-code-body';

function getOpContext(lines: string[], currentLine: number): OpContext {
    // Walk backwards from cursor, tracking brace depth and keywords
    let depth = 0;
    const contextStack: string[] = [];

    for (let i = currentLine; i >= 0; i--) {
        const line = lines[i]!;
        for (let j = (i === currentLine ? line.length - 1 : line.length - 1); j >= 0; j--) {
            const ch = line[j];
            if (ch === '}') {
                depth++;
            } else if (ch === '{') {
                if (depth > 0) {
                    depth--;
                } else {
                    // This opening brace is the one enclosing the cursor
                    const textBefore = line.slice(0, j).trim();
                    if (/\d{3}\s*:?\s*$/.test(textBefore)) {
                        contextStack.push('status-code-body');
                    } else if (/\bresponse\s*:?\s*$/.test(textBefore)) {
                        contextStack.push('response-body');
                    } else if (/\brequest\s*:?\s*$/.test(textBefore)) {
                        contextStack.push('request-body');
                    } else if (/\b(get|post|put|patch|delete)\s*:?\s*$/.test(textBefore)) {
                        contextStack.push('operation-body');
                    } else if (/\/[a-zA-Z0-9_/:.-]+\s*$/.test(textBefore)) {
                        contextStack.push('route-body');
                    } else {
                        contextStack.push('unknown');
                    }
                }
            }
        }
    }

    return (contextStack[0] as OpContext) ?? 'top-level';
}

function isInsideTypeConstraints(lines: string[], currentLine: number, textBefore: string): boolean {
    // Check if there's an unclosed '(' with a type name before it
    let parenDepth = 0;
    const fullText = textBefore;
    for (let i = fullText.length - 1; i >= 0; i--) {
        if (fullText[i] === ')') parenDepth++;
        else if (fullText[i] === '(') {
            if (parenDepth > 0) {
                parenDepth--;
            } else {
                // Found unmatched opening paren; check if preceded by a type name
                const before = fullText.slice(0, i).trim();
                return /\b(string|number|int|bigint|array|tuple|record)$/.test(before);
            }
        }
    }
    return false;
}

function isInsideBraces(lines: string[], currentLine: number): boolean {
    let depth = 0;
    for (let i = 0; i <= currentLine; i++) {
        const line = lines[i]!;
        for (const ch of line) {
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
        }
    }
    return depth > 0;
}
