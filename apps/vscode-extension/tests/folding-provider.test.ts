import { FoldingRangeKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getFoldingRanges } from '../src/server/folding-provider.js';

function makeDoc(content: string) {
    return TextDocument.create('file:///test.ck', 'contract-ck', 1, content);
}

describe('getFoldingRanges', () => {
    it('folds a single contract block from `{` line to line before `}`', () => {
        const src = `\
contract User: {
    name: string
    email: email
}
`;
        const ranges = getFoldingRanges({ textDocument: { uri: 'file:///x.ck' } }, makeDoc(src));
        expect(ranges).toContainEqual({ startLine: 0, endLine: 2 });
    });

    it('folds nested operation/method blocks', () => {
        const src = `\
operation /users: {
    get: {
        service: Svc.list
    }
}
`;
        const ranges = getFoldingRanges({ textDocument: { uri: 'file:///x.ck' } }, makeDoc(src));
        expect(ranges).toEqual(
            expect.arrayContaining([
                { startLine: 0, endLine: 3 },
                { startLine: 1, endLine: 2 },
            ]),
        );
    });

    it('folds runs of comment lines as a comment region', () => {
        const src = `\
# line one
# line two
# line three
contract X: { f: string }
`;
        const ranges = getFoldingRanges({ textDocument: { uri: 'file:///x.ck' } }, makeDoc(src));
        expect(ranges).toContainEqual({ startLine: 0, endLine: 2, kind: FoldingRangeKind.Comment });
    });

    it('does not treat `{` inside a string literal as a fold start', () => {
        const src = `\
contract X: {
    s: string = "value with { brace"
}
`;
        const ranges = getFoldingRanges({ textDocument: { uri: 'file:///x.ck' } }, makeDoc(src));
        // Only one fold from line 0 to line 1 (before closing brace on line 2).
        expect(ranges.filter(r => r.kind === undefined)).toEqual([{ startLine: 0, endLine: 1 }]);
    });

    it('skips single-line `{ }` blocks (start === end after `endLine - 1` rule)', () => {
        const src = 'contract X: { f: string }\n';
        const ranges = getFoldingRanges({ textDocument: { uri: 'file:///x.ck' } }, makeDoc(src));
        expect(ranges).toEqual([]);
    });
});
