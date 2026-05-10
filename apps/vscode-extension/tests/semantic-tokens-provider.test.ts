import { TextDocument } from 'vscode-languageserver-textdocument';
import { encodeDeltaTokens, getSemanticTokens, TOKEN_TYPES } from '../src/server/semantic-tokens-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function makeDoc(content: string) {
    return TextDocument.create('file:///test.ck', 'contract-ck', 1, content);
}

function parseTokens(data: number[]): Array<{ line: number; char: number; length: number; type: string }> {
    const tokens: Array<{ line: number; char: number; length: number; type: string }> = [];
    let line = 0;
    let char = 0;
    for (let i = 0; i < data.length; i += 5) {
        const lineDelta = data[i]!;
        const charDelta = data[i + 1]!;
        const length = data[i + 2]!;
        const typeIdx = data[i + 3]!;
        line += lineDelta;
        char = lineDelta === 0 ? char + charDelta : charDelta;
        tokens.push({ line, char, length, type: TOKEN_TYPES[typeIdx]! });
    }
    return tokens;
}

describe('getSemanticTokens', () => {
    it('classifies keywords, scalar types, and known model names', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        const doc = makeDoc('contract M: { u: User, s: string }');
        const result = getSemanticTokens({ textDocument: { uri: doc.uri } }, doc, index);
        const tokens = parseTokens(result.data);
        const kinds = new Set(tokens.map(t => t.type));
        expect(kinds).toContain('keyword'); // contract
        expect(kinds).toContain('class'); // User, M
        expect(kinds).toContain('type'); // string (scalar)
    });

    it('classifies modifiers as `modifier`', () => {
        const doc = makeDoc('contract M: {\n    readonly id: uuid\n}');
        const result = getSemanticTokens({ textDocument: { uri: doc.uri } }, doc, new WorkspaceIndex());
        const tokens = parseTokens(result.data);
        expect(tokens.find(t => t.type === 'modifier')).toBeDefined();
    });

    it('treats string literals and `#` comments as their own tokens', () => {
        const doc = makeDoc('# leading comment\ncontract M: { f: string = "hello" }');
        const result = getSemanticTokens({ textDocument: { uri: doc.uri } }, doc, new WorkspaceIndex());
        const tokens = parseTokens(result.data);
        expect(tokens.find(t => t.type === 'comment')).toBeDefined();
        expect(tokens.find(t => t.type === 'string')).toBeDefined();
    });
});

describe('encodeDeltaTokens', () => {
    it('encodes a single token as 5 numbers with absolute initial position', () => {
        const data = encodeDeltaTokens([{ line: 2, char: 4, length: 3, type: 'keyword', modifiers: 0 }]);
        expect(data).toEqual([2, 4, 3, TOKEN_TYPES.indexOf('keyword'), 0]);
    });

    it('emits charDelta relative to previous token on the same line', () => {
        const data = encodeDeltaTokens([
            { line: 0, char: 0, length: 8, type: 'keyword', modifiers: 0 },
            { line: 0, char: 9, length: 4, type: 'class', modifiers: 0 },
        ]);
        // [0,0,8,kw,0, 0,9,4,cls,0] — second token's charDelta is 9 (from char 0 → char 9)
        expect(data[5]).toBe(0);
        expect(data[6]).toBe(9);
    });

    it('resets charDelta when the line changes', () => {
        const data = encodeDeltaTokens([
            { line: 0, char: 5, length: 3, type: 'keyword', modifiers: 0 },
            { line: 2, char: 4, length: 3, type: 'modifier', modifiers: 0 },
        ]);
        expect(data[5]).toBe(2); // line delta
        expect(data[6]).toBe(4); // absolute char on the new line
    });

    it('sorts unsorted input by (line, char) before encoding', () => {
        const data = encodeDeltaTokens([
            { line: 1, char: 0, length: 1, type: 'keyword', modifiers: 0 },
            { line: 0, char: 0, length: 1, type: 'modifier', modifiers: 0 },
        ]);
        // First token must be the line-0 modifier
        expect(data[0]).toBe(0);
        expect(data[3]).toBe(TOKEN_TYPES.indexOf('modifier'));
    });
});
