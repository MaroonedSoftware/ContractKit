import { TextDocument } from 'vscode-languageserver-textdocument';
import { getDocumentLinks } from '../src/server/document-link-provider.js';

function makeDoc(uri: string, content: string) {
    return TextDocument.create(uri, 'contract-ck', 1, content);
}

describe('getDocumentLinks', () => {
    it('emits a link for https:// strings with target == raw URL', () => {
        const doc = makeDoc(
            'file:///Users/x/api.ck',
            'operation /foo: { get: { plugins: { bruno: { template: "https://example.com/foo.yml" } } } }',
        );
        const links = getDocumentLinks({ textDocument: { uri: doc.uri } }, doc);
        const https = links.filter(l => l.target?.startsWith('https://'));
        expect(https).toHaveLength(1);
        expect(https[0]!.target).toBe('https://example.com/foo.yml');
    });

    it('emits a link for file:// strings preserving the original URL', () => {
        const doc = makeDoc(
            'file:///Users/x/api.ck',
            'operation /foo: { get: { plugins: { bruno: { template: "file:///etc/hosts" } } } }',
        );
        const links = getDocumentLinks({ textDocument: { uri: doc.uri } }, doc);
        expect(links.find(l => l.target === 'file:///etc/hosts')).toBeDefined();
    });

    it('resolves relative ./ paths against the document directory', () => {
        const doc = makeDoc(
            'file:///Users/x/api.ck',
            'operation /foo: { get: { plugins: { bruno: { template: "./request.yml" } } } }',
        );
        const links = getDocumentLinks({ textDocument: { uri: doc.uri } }, doc);
        expect(links.find(l => l.target === 'file:///Users/x/request.yml')).toBeDefined();
    });

    it('ignores plain string literals that are not URLs or relative paths', () => {
        const doc = makeDoc('file:///x.ck', 'contract M: { mode(strict) }');
        const links = getDocumentLinks({ textDocument: { uri: doc.uri } }, doc);
        expect(links).toEqual([]);
    });

    it('link range covers the string contents (excluding quotes)', () => {
        const content = 'x: "https://a.test"';
        const doc = makeDoc('file:///x.ck', content);
        const links = getDocumentLinks({ textDocument: { uri: doc.uri } }, doc);
        expect(links).toHaveLength(1);
        const start = doc.offsetAt(links[0]!.range.start);
        const end = doc.offsetAt(links[0]!.range.end);
        expect(content.slice(start, end)).toBe('https://a.test');
    });
});
