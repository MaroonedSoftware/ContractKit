import { TextDocument } from 'vscode-languageserver-textdocument';
import { getHover } from '../src/server/hover-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

describe('getHover', () => {
    it('returns hover info for builtin types', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: string\n}');
        const index = new WorkspaceIndex();
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('z.string()') });
    });

    it('returns hover info for model references', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    ref: User\n}');
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 10 } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('User') });
    });

    it('returns null for unknown words', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: xyz\n}');
        const index = new WorkspaceIndex();
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, doc, index);
        expect(hover).toBeNull();
    });

    it('returns null when cursor is on whitespace', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    \n}');
        const index = new WorkspaceIndex();
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 2 } }, doc, index);
        expect(hover).toBeNull();
    });

    it('returns coerced number hover for number type', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: number\n}');
        const index = new WorkspaceIndex();
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('z.coerce.number()') });
    });

    it('returns coerced int hover for int type', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: int\n}');
        const index = new WorkspaceIndex();
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('z.coerce.number().int()') });
    });

    it('resolves the last token on a line when the cursor sits at end-of-line (builtin type)', () => {
        const lineText = '    createdAt: readonly datetime';
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, `contract M: {\n${lineText}\n}`);
        const index = new WorkspaceIndex();
        // Cursor immediately after the final `datetime` token — character === line length
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: lineText.length } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('Luxon `DateTime`') });
    });

    it('resolves a model reference that is the last token on a line at end-of-line', () => {
        const lineText = '    ref: User';
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, `contract M: {\n${lineText}\n}`);
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        const hover = getHover({ textDocument: { uri: doc.uri }, position: { line: 1, character: lineText.length } }, doc, index);
        expect(hover).not.toBeNull();
        expect(hover!.contents).toMatchObject({ kind: 'markdown', value: expect.stringContaining('User') });
    });
});
