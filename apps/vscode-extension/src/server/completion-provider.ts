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

const COMPOUND_TYPES = ['array', 'tuple', 'record', 'enum', 'literal', 'lazy'];

const CONSTRAINT_KEYS = ['min', 'max', 'length', 'len', 'regex'];

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const OP_BLOCK_KEYWORDS = ['service', 'sdk', 'query', 'headers', 'request', 'response', 'security'];

const OBJECT_MODES: Array<{ label: string; detail: string }> = [
    { label: 'strict', detail: 'Reject unknown keys (z.strictObject)' },
    { label: 'strip',  detail: 'Strip unknown keys silently (z.object)' },
    { label: 'loose',  detail: 'Pass unknown keys through (z.looseObject)' },
];

const SECURITY_SCHEMES: Array<{ label: string; detail: string; insertText?: string }> = [
    { label: 'bearer', detail: 'Bearer token (Authorization: Bearer <token>)' },
    { label: 'apiKey', detail: 'API key via header/query/cookie', insertText: 'apiKey(header="$1")' },
    { label: 'none', detail: 'No authentication — public endpoint' },
];

const SECURITY_SCHEME_ARG_KEYS = ['header', 'query', 'cookie'];

const ROUTE_MODIFIERS: Array<{ label: string; detail: string }> = [
    { label: 'internal',   detail: 'Exclude from SDK and API docs' },
    { label: 'deprecated', detail: 'Mark as deprecated in SDK and API docs' },
];

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

    // After a pipe or ampersand — union/intersection type continuation
    if (/[|&]\s*\w*$/.test(textBefore)) {
        return [
            ...BUILTIN_SCALAR_TYPES.map((t) => ({
                label: t,
                kind: CompletionItemKind.TypeParameter,
            })),
            ...COMPOUND_TYPES.map((t) => ({
                label: t,
                kind: CompletionItemKind.TypeParameter,
                detail: 'Compound type',
                insertText: `${t}($1)`,
                insertTextFormat: 2,
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

    // At top-level (before a model declaration) — offer object mode modifiers
    if (/^\s*$/.test(textBefore) && !isInsideBraces(lines, line)) {
        return OBJECT_MODES.map(({ label, detail }) => ({
            label,
            kind: CompletionItemKind.Keyword,
            detail: `Model mode: ${detail}`,
        }));
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

    // After route path + `:` at top-level — offer route modifiers
    if (context === 'top-level' && /\/[a-zA-Z0-9_/:.-]+\s*:\s*\w*$/.test(textBefore)) {
        return ROUTE_MODIFIERS.map(({ label, detail }) => ({
            label,
            kind: CompletionItemKind.Keyword,
            detail,
        }));
    }

    // After `httpMethod:` in route-body — offer modifiers (before `{`)
    if (context === 'route-body' && /\b(?:get|post|put|patch|delete)\s*:\s*(?:(?:internal|deprecated)\s+)*\w*$/.test(textBefore)) {
        return ROUTE_MODIFIERS.map(({ label, detail }) => ({
            label,
            kind: CompletionItemKind.Keyword,
            detail,
        }));
    }

    // At route body level — offer HTTP methods, params, and mode modifiers
    if (context === 'route-body' && /^\s*\w*$/.test(textBefore)) {
        return [
            { label: 'params', kind: CompletionItemKind.Keyword },
            ...OBJECT_MODES.map(({ label, detail }) => ({
                label,
                kind: CompletionItemKind.Keyword,
                detail: `params mode: ${detail}`,
            })),
            ...HTTP_METHODS.map((m) => ({
                label: m,
                kind: CompletionItemKind.Keyword,
                detail: `HTTP ${m.toUpperCase()}`,
            })),
        ];
    }

    // After a mode modifier in route-body — complete 'params'
    if (context === 'route-body' && /^\s*(strict|strip|loose)\s+\w*$/.test(textBefore)) {
        return [{ label: 'params', kind: CompletionItemKind.Keyword }];
    }

    // At operation body level — offer operation keywords and mode modifiers
    if (context === 'operation-body' && /^\s*\w*$/.test(textBefore)) {
        return [
            ...OP_BLOCK_KEYWORDS.map((k) => ({
                label: k,
                kind: CompletionItemKind.Keyword,
            })),
            ...OBJECT_MODES.map(({ label, detail }) => ({
                label,
                kind: CompletionItemKind.Keyword,
                detail: `query/headers mode: ${detail}`,
            })),
        ];
    }

    // After a mode modifier in operation-body — complete 'query' or 'headers'
    if (context === 'operation-body' && /^\s*(strict|strip|loose)\s+\w*$/.test(textBefore)) {
        return [
            { label: 'query',   kind: CompletionItemKind.Keyword },
            { label: 'headers', kind: CompletionItemKind.Keyword },
        ];
    }

    // After security: — offer security schemes
    if (/security\s*:\s*\w*$/.test(textBefore)) {
        return SECURITY_SCHEMES.map((s) => ({
            label: s.label,
            kind: CompletionItemKind.Value,
            detail: s.detail,
            ...(s.insertText ? { insertText: s.insertText, insertTextFormat: 2 } : {}),
        }));
    }

    // After a pipe in a security expression — offer more schemes (not 'none')
    if (/security\s*:\s*.+\|\s*\w*$/.test(textBefore)) {
        return SECURITY_SCHEMES.filter((s) => s.label !== 'none').map((s) => ({
            label: s.label,
            kind: CompletionItemKind.Value,
            detail: s.detail,
            ...(s.insertText ? { insertText: s.insertText, insertTextFormat: 2 } : {}),
        }));
    }

    // Inside a security scheme's argument list — offer arg keys
    if (/security\s*:\s*\w+\(\s*\w*$/.test(textBefore) ||
        /security\s*:\s*\w+\(.*,\s*\w*$/.test(textBefore)) {
        return SECURITY_SCHEME_ARG_KEYS.map((k) => ({
            label: k,
            kind: CompletionItemKind.Property,
            detail: 'Security scheme argument',
            insertText: `${k}="$1"`,
            insertTextFormat: 2,
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

    // After query: or headers: or params: (optionally preceded by a mode modifier) — offer types and model names
    if (/(?:(?:strict|strip|loose)\s+)?(?:query|headers|params)\s*:\s*\w*$/.test(textBefore)) {
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
                insertTextFormat: 2,
            })),
            ...index.getAllModelNames().map((name) => ({
                label: name,
                kind: CompletionItemKind.Class,
                detail: 'Model reference',
            })),
        ];
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
                return /\b(string|number|int|bigint|boolean|date|datetime|email|url|uuid|array|tuple|record|enum|literal|lazy)$/.test(before);
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
