import { DocumentHighlightKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDocumentHighlights, getReferences } from '../src/server/references-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function makeDoc(uri: string, content: string) {
    return TextDocument.create(uri, 'contract-ck', 1, content);
}

describe('getReferences', () => {
    it('returns cross-file references to a model name, excluding the declaration by default', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        index.indexFromSource(
            'file:///main.ck',
            `\
contract Wrapper: User & {
    user: User
}
`,
        );
        const doc = makeDoc('file:///main.ck', 'contract Wrapper: User & {\n    user: User\n}\n');
        // Cursor on `User` in `: User &` (line 0, char 19)
        const refs = getReferences(
            { textDocument: { uri: 'file:///main.ck' }, position: { line: 0, character: 20 }, context: { includeDeclaration: false } },
            doc,
            index,
        );
        const uris = refs.map(r => r.uri);
        expect(uris).toEqual(['file:///main.ck', 'file:///main.ck']);
        // Decl excluded
        expect(refs.every(r => r.uri !== 'file:///user.ck' || r.range.start.line !== 0)).toBe(true);
    });

    it('includes the declaration when context.includeDeclaration is true', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        index.indexFromSource('file:///main.ck', 'contract M: { u: User }\n');
        const doc = makeDoc('file:///main.ck', 'contract M: { u: User }\n');
        const refs = getReferences(
            { textDocument: { uri: doc.uri }, position: { line: 0, character: 18 }, context: { includeDeclaration: true } },
            doc,
            index,
        );
        expect(refs.some(r => r.uri === 'file:///user.ck')).toBe(true);
    });

    it('returns service references when the cursor is on a service name', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource(
            'file:///ops.ck',
            `\
options {
    services: {
        Svc: "#x.js"
    }
}

operation /a: { get: { service: Svc.list } }
operation /b: { get: { service: Svc.find } }
`,
        );
        const doc = makeDoc(
            'file:///ops.ck',
            `\
options {
    services: {
        Svc: "#x.js"
    }
}

operation /a: { get: { service: Svc.list } }
operation /b: { get: { service: Svc.find } }
`,
        );
        // Cursor on `Svc` in line 6 `service: Svc.list`
        const lineText = 'operation /a: { get: { service: Svc.list } }';
        const svcChar = lineText.indexOf('Svc') + 1;
        const refs = getReferences(
            { textDocument: { uri: doc.uri }, position: { line: 6, character: svcChar }, context: { includeDeclaration: false } },
            doc,
            index,
        );
        // Two non-decl Svc usages on lines 6 and 7
        expect(refs).toHaveLength(2);
    });

    it('returns empty when cursor is on whitespace', () => {
        const index = new WorkspaceIndex();
        const doc = makeDoc('file:///x.ck', 'contract M: {\n    \n}');
        const refs = getReferences(
            { textDocument: { uri: doc.uri }, position: { line: 1, character: 2 }, context: { includeDeclaration: false } },
            doc,
            index,
        );
        expect(refs).toEqual([]);
    });
});

describe('getDocumentHighlights', () => {
    it('returns occurrences only in the current file, with declaration as Write kind', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        const src = `\
contract User: { name: string }
contract M: { u: User, alt: User }
`;
        index.indexFromSource('file:///user.ck', src);
        const doc = makeDoc('file:///user.ck', src);
        // Cursor on `User` reference on line 1
        const highlights = getDocumentHighlights({ textDocument: { uri: doc.uri }, position: { line: 1, character: 18 } }, doc, index);
        const decl = highlights.find(h => h.range.start.line === 0);
        const otherFile = highlights.filter(h => h.range.start.line !== 0 && h.range.start.line !== 1);
        expect(decl?.kind).toBe(DocumentHighlightKind.Write);
        expect(otherFile).toEqual([]);
    });
});
