import { TextDocument } from 'vscode-languageserver-textdocument';
import { getFormattingEdits } from '../src/server/formatting-provider.js';

function makeDoc(content: string) {
    return TextDocument.create('file:///test.ck', 'contract-ck', 1, content);
}

describe('getFormattingEdits', () => {
    it('returns a full-document edit when the formatter rewrites the source', () => {
        // Inconsistent indentation that the printer normalizes
        const doc = makeDoc('contract User:{name:string}\n');
        const edits = getFormattingEdits({ textDocument: { uri: doc.uri }, options: { tabSize: 4, insertSpaces: true } }, doc);
        expect(edits).toHaveLength(1);
        expect(edits[0]!.newText).toContain('contract User');
        expect(edits[0]!.newText).toMatch(/\n$/);
    });

    it('returns no edits when the document is already formatted', () => {
        const formatted = 'contract User: {\n    name: string\n}\n';
        const doc = makeDoc(formatted);
        const edits = getFormattingEdits({ textDocument: { uri: doc.uri }, options: { tabSize: 4, insertSpaces: true } }, doc);
        expect(edits).toEqual([]);
    });

    it('returns no edits on parse error rather than emitting garbage', () => {
        const doc = makeDoc('contract @@@ broken');
        const edits = getFormattingEdits({ textDocument: { uri: doc.uri }, options: { tabSize: 4, insertSpaces: true } }, doc);
        expect(edits).toEqual([]);
    });
});
