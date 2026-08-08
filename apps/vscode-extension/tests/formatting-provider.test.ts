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

    it('preserves every construct the CLI formatter preserves', () => {
        // Format-on-save runs this path, so anything the printer drops is deleted from the user's
        // file the moment they hit save. The editor gets the behaviour by depending on the same
        // printCk as the Prettier plugin — this pins that they cannot drift apart.
        const source = `# ContractKit contracts for billing.
options {
    keys: {
        area: billing # interpolated as {{area}}
    }
    services: {
        PetService: #modules/pet/pet.service.js
    }
}

operation /art/{id}: {
    params: {
        id: uuid
    }
    get: {
        response: {
            200: {
                # served straight from object storage
                image/png: binary
                image/jpeg: binary
            }
            304: {}
            404(documented): { application/json: Problem }
        }
    }
}
`;
        const doc = makeDoc(source);
        expect(getFormattingEdits({ textDocument: { uri: doc.uri }, options: { tabSize: 4, insertSpaces: true } }, doc)).toEqual([]);
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
