import { parseCk, DiagnosticCollector } from '@contractkit/core';
import { getInlayHints } from '../src/server/inlay-hint-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function parsed(uri: string, text: string) {
    return { ast: parseCk(text, uri.replace('file://', ''), new DiagnosticCollector()), version: 1 };
}

describe('getInlayHints', () => {
    it('shows inherited field names next to a model with a single base', () => {
        const baseSrc = 'contract User: { name: string, email: email }\n';
        const childSrc = 'contract Admin: User & { role: string }\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', baseSrc);
        index.indexFromSource('file:///admin.ck', childSrc);

        const hints = getInlayHints(
            { textDocument: { uri: 'file:///admin.ck' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } } },
            parsed('file:///admin.ck', childSrc),
            index,
            childSrc,
        );
        expect(hints).toHaveLength(1);
        expect(hints[0]!.label).toBe('+ name, email');
    });

    it('omits inherited fields that the child overrides', () => {
        const baseSrc = 'contract User: { name: string, email: email }\n';
        const childSrc = 'contract Admin: User & {\n    name: string\n}\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', baseSrc);
        index.indexFromSource('file:///admin.ck', childSrc);

        const hints = getInlayHints(
            { textDocument: { uri: 'file:///admin.ck' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } } },
            parsed('file:///admin.ck', childSrc),
            index,
            childSrc,
        );
        expect(hints[0]!.label).toBe('+ email');
    });

    it('returns no hints for models without bases', () => {
        const src = 'contract User: { name: string }\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', src);
        const hints = getInlayHints(
            { textDocument: { uri: 'file:///user.ck' }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 100 } } },
            parsed('file:///user.ck', src),
            index,
            src,
        );
        expect(hints).toEqual([]);
    });
});
