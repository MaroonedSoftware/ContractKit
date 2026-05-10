import { TextDocument } from 'vscode-languageserver-textdocument';
import { getSignatureHelp } from '../src/server/signature-help-provider.js';

function makeDoc(content: string) {
    return TextDocument.create('file:///test.ck', 'contract-ck', 1, content);
}

describe('getSignatureHelp', () => {
    it('returns the string signature when cursor is inside `string(`', () => {
        const doc = makeDoc('contract M: { f: string( }');
        const help = getSignatureHelp({ textDocument: { uri: doc.uri }, position: { line: 0, character: 24 } }, doc);
        expect(help).not.toBeNull();
        expect(help!.signatures[0]!.label).toContain('string(');
        expect(help!.activeParameter).toBe(0);
    });

    it('advances activeParameter for each comma in the call', () => {
        const doc = makeDoc('contract M: { f: string(min=1, max=10, }');
        const help = getSignatureHelp({ textDocument: { uri: doc.uri }, position: { line: 0, character: 39 } }, doc);
        expect(help!.activeParameter).toBe(2);
    });

    it('returns null when cursor is not inside a known constraint call', () => {
        const doc = makeDoc('contract M: { f: string }');
        const help = getSignatureHelp({ textDocument: { uri: doc.uri }, position: { line: 0, character: 22 } }, doc);
        expect(help).toBeNull();
    });

    it('returns the discriminated signature inside `discriminated(`', () => {
        const doc = makeDoc('contract Event: discriminated(by=type, A | B)');
        const help = getSignatureHelp({ textDocument: { uri: doc.uri }, position: { line: 0, character: 30 } }, doc);
        expect(help!.signatures[0]!.label).toContain('discriminated');
    });
});
