import { ResponseError } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getRenameEdits, prepareRename } from '../src/server/rename-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function makeDoc(uri: string, content: string) {
    return TextDocument.create(uri, 'contract-ck', 1, content);
}

describe('prepareRename', () => {
    it('returns the identifier range when cursor is on a known model', () => {
        const index = new WorkspaceIndex();
        const src = 'contract User: { name: string }\n';
        index.indexFromSource('file:///user.ck', src);
        const doc = makeDoc('file:///user.ck', src);
        const range = prepareRename({ textDocument: { uri: doc.uri }, position: { line: 0, character: 11 } }, doc, index);
        expect(range).toEqual({ start: { line: 0, character: 9 }, end: { line: 0, character: 13 } });
    });

    it('returns null when cursor is not on a known symbol', () => {
        const index = new WorkspaceIndex();
        const doc = makeDoc('file:///x.ck', 'contract X: { f: string }');
        const range = prepareRename({ textDocument: { uri: doc.uri }, position: { line: 0, character: 16 } }, doc, index);
        expect(range).toBeNull();
    });
});

describe('getRenameEdits', () => {
    it('rewrites the declaration and every reference across files', () => {
        const userSrc = 'contract User: { name: string }\n';
        const mainSrc = 'contract Wrapper: User & {\n    user: User\n}\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);
        index.indexFromSource('file:///main.ck', mainSrc);
        const doc = makeDoc('file:///user.ck', userSrc);

        const result = getRenameEdits(
            { textDocument: { uri: doc.uri }, position: { line: 0, character: 11 }, newName: 'Customer' },
            doc,
            index,
        );
        expect(result).not.toBeInstanceOf(ResponseError);
        const edit = result as { changes: Record<string, unknown[]> };
        expect(edit.changes['file:///user.ck']).toHaveLength(1);
        expect(edit.changes['file:///main.ck']).toHaveLength(2);
    });

    it('rejects an invalid identifier', () => {
        const index = new WorkspaceIndex();
        const src = 'contract User: { name: string }\n';
        index.indexFromSource('file:///user.ck', src);
        const doc = makeDoc('file:///user.ck', src);
        const result = getRenameEdits(
            { textDocument: { uri: doc.uri }, position: { line: 0, character: 11 }, newName: '123Bad' },
            doc,
            index,
        );
        expect(result).toBeInstanceOf(ResponseError);
    });

    it('rejects a name that collides with an existing model', () => {
        const src = `\
contract User: { name: string }
contract Admin: User & { role: string }
`;
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///x.ck', src);
        const doc = makeDoc('file:///x.ck', src);
        const result = getRenameEdits(
            { textDocument: { uri: doc.uri }, position: { line: 0, character: 11 }, newName: 'Admin' },
            doc,
            index,
        );
        expect(result).toBeInstanceOf(ResponseError);
    });

    it('returns empty changes when new name equals old name', () => {
        const src = 'contract User: { name: string }\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', src);
        const doc = makeDoc('file:///user.ck', src);
        const result = getRenameEdits(
            { textDocument: { uri: doc.uri }, position: { line: 0, character: 11 }, newName: 'User' },
            doc,
            index,
        );
        expect(result).toEqual({ changes: {} });
    });
});
