import { SemanticTokens, SemanticTokensLegend, SemanticTokensParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';

export const TOKEN_TYPES = ['type', 'class', 'interface', 'keyword', 'modifier', 'property', 'string', 'number', 'regexp', 'comment'] as const;
export const TOKEN_MODIFIERS = ['defaultLibrary', 'deprecated', 'readonly'] as const;

type TokenType = (typeof TOKEN_TYPES)[number];

export const SEMANTIC_TOKENS_LEGEND: SemanticTokensLegend = {
    tokenTypes: [...TOKEN_TYPES],
    tokenModifiers: [...TOKEN_MODIFIERS],
};

const KEYWORDS = new Set([
    'contract',
    'operation',
    'options',
    'keys',
    'services',
    'security',
    'request',
    'response',
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'params',
    'query',
    'headers',
    'body',
    'mode',
    'format',
    'discriminated',
    'lazy',
    'literal',
    'enum',
    'array',
    'tuple',
    'record',
    'union',
    'plugins',
]);

const MODIFIERS = new Set(['readonly', 'writeonly', 'deprecated', 'override', 'internal', 'public']);

const SCALAR_TYPES = new Set([
    'string',
    'number',
    'int',
    'bigint',
    'boolean',
    'date',
    'time',
    'datetime',
    'duration',
    'interval',
    'email',
    'url',
    'uuid',
    'unknown',
    'null',
    'object',
    'binary',
    'json',
]);

const MAX_FILE_SIZE = 200_000;

interface RawToken {
    line: number;
    char: number;
    length: number;
    type: TokenType;
    modifiers: number;
}

export function getSemanticTokens(_params: SemanticTokensParams, document: TextDocument, index: WorkspaceIndex): SemanticTokens {
    const text = document.getText();
    if (text.length > MAX_FILE_SIZE) return { data: [] };

    const lines = text.split('\n');
    const modelNames = new Set(index.getAllModelNames());
    const serviceNames = new Set(index.getAllServiceDeclNames());

    const tokens: RawToken[] = [];
    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
        tokenizeLine(lines[lineNum]!, lineNum, modelNames, serviceNames, tokens);
    }

    return { data: encodeDeltaTokens(tokens) };
}

/** Emits raw tokens (absolute positions) for a single line, walking char-by-char to handle strings and comments. */
function tokenizeLine(line: string, lineNum: number, modelNames: Set<string>, serviceNames: Set<string>, out: RawToken[]): void {
    let i = 0;
    while (i < line.length) {
        const ch = line[i]!;
        if (ch === '#') {
            // Comments are usually surfaced by TextMate already; we still emit them so semantic tokens
            // override consistently when both grammars are active.
            out.push({ line: lineNum, char: i, length: line.length - i, type: 'comment', modifiers: 0 });
            return;
        }
        if (ch === '"') {
            const start = i;
            i++;
            while (i < line.length && line[i] !== '"') {
                if (line[i] === '\\' && i + 1 < line.length) i += 2;
                else i++;
            }
            if (i < line.length) i++; // closing quote
            out.push({ line: lineNum, char: start, length: i - start, type: 'string', modifiers: 0 });
            continue;
        }
        if (ch === '/' && line[i + 1] !== '/') {
            // Possible regex literal — only legal as the value of `regex=/.../`.
            // Look behind for the `regex=` token.
            const prefix = line.slice(0, i);
            if (/regex\s*=\s*$/.test(prefix)) {
                const start = i;
                i++;
                while (i < line.length && line[i] !== '/') {
                    if (line[i] === '\\' && i + 1 < line.length) i += 2;
                    else i++;
                }
                if (i < line.length) i++; // closing /
                out.push({ line: lineNum, char: start, length: i - start, type: 'regexp', modifiers: 0 });
                continue;
            }
        }
        if (/[0-9]/.test(ch) && !isInIdentifier(line, i)) {
            const start = i;
            while (i < line.length && /[0-9_.]/.test(line[i]!)) i++;
            out.push({ line: lineNum, char: start, length: i - start, type: 'number', modifiers: 0 });
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            const start = i;
            while (i < line.length && /[A-Za-z0-9_]/.test(line[i]!)) i++;
            const word = line.slice(start, i);
            const tok = classifyWord(word, modelNames, serviceNames);
            if (tok) out.push({ line: lineNum, char: start, length: word.length, type: tok.type, modifiers: tok.modifiers });
            continue;
        }
        i++;
    }
}

function classifyWord(word: string, modelNames: Set<string>, serviceNames: Set<string>): { type: TokenType; modifiers: number } | null {
    if (KEYWORDS.has(word)) return { type: 'keyword', modifiers: 0 };
    if (MODIFIERS.has(word)) {
        let modifiers = 0;
        if (word === 'readonly') modifiers |= bit('readonly');
        if (word === 'deprecated') modifiers |= bit('deprecated');
        return { type: 'modifier', modifiers };
    }
    if (SCALAR_TYPES.has(word)) return { type: 'type', modifiers: bit('defaultLibrary') };
    if (modelNames.has(word)) return { type: 'class', modifiers: 0 };
    if (serviceNames.has(word)) return { type: 'interface', modifiers: 0 };
    return null;
}

function isInIdentifier(line: string, idx: number): boolean {
    return idx > 0 && /[A-Za-z0-9_]/.test(line[idx - 1]!);
}

function bit(name: (typeof TOKEN_MODIFIERS)[number]): number {
    return 1 << TOKEN_MODIFIERS.indexOf(name);
}

/** LSP semantic tokens use a delta-encoded flat number array. Tokens must be sorted by (line, char) before encoding. */
export function encodeDeltaTokens(tokens: RawToken[]): number[] {
    tokens.sort((a, b) => (a.line - b.line) || (a.char - b.char));
    const data: number[] = [];
    let prevLine = 0;
    let prevChar = 0;
    for (const tok of tokens) {
        const lineDelta = tok.line - prevLine;
        const charDelta = lineDelta === 0 ? tok.char - prevChar : tok.char;
        data.push(lineDelta, charDelta, tok.length, TOKEN_TYPES.indexOf(tok.type), tok.modifiers);
        prevLine = tok.line;
        prevChar = tok.char;
    }
    return data;
}
