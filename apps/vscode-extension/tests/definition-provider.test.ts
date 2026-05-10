import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDefinition } from '../src/server/definition-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

describe('getDefinition', () => {
    it('returns null when cursor is not on an identifier', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: string\n}');
        const index = new WorkspaceIndex();
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 0 } }, doc, index);
        expect(def).toBeNull();
    });

    it('jumps to model declaration with precise range pointing at the name', () => {
        const userSrc = `\
# Comment line
contract User: {
    name: string
}
`;
        const doc = TextDocument.create('file:///main.ck', 'contract-ck', 1, 'contract Wrapper: {\n    user: User\n}');
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);

        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 12 } }, doc, index);

        expect(def).not.toBeNull();
        expect(def!.uri).toBe('file:///user.ck');
        // `contract User:` is on the second line (zero-based 1); `User` starts at column 9
        expect(def!.range).toEqual({
            start: { line: 1, character: 9 },
            end: { line: 1, character: 13 },
        });
    });

    it('jumps to service declaration in options.services block', () => {
        const opSrc = `\
options {
    services: {
        PaymentsService: "#src/services/payments.service.js"
    }
}

operation /payments: {
    get: {
        service: PaymentsService.list
    }
}
`;
        const doc = TextDocument.create('file:///ops.ck', 'contract-ck', 1, opSrc);
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///ops.ck', opSrc);

        // Cursor on `PaymentsService` in the `service:` line
        const usageLine = 8;
        const usageChar = opSrc.split('\n')[usageLine]!.indexOf('PaymentsService') + 3;
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: usageLine, character: usageChar } }, doc, index);

        expect(def).not.toBeNull();
        expect(def!.uri).toBe('file:///ops.ck');
        // `PaymentsService:` is on line index 2, indented 8 spaces
        expect(def!.range).toEqual({
            start: { line: 2, character: 8 },
            end: { line: 2, character: 23 },
        });
    });

    it('returns null for unknown words', () => {
        const doc = TextDocument.create('file:///test.ck', 'contract-ck', 1, 'contract M: {\n    f: Unknown\n}');
        const index = new WorkspaceIndex();
        const def = getDefinition({ textDocument: { uri: doc.uri }, position: { line: 1, character: 9 } }, doc, index);
        expect(def).toBeNull();
    });
});
