import { parseCk, DiagnosticCollector } from '@contractkit/core';
import { getCodeLenses, resolveCodeLens } from '../src/server/codelens-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function parsed(uri: string, text: string) {
    const filePath = uri.replace('file://', '');
    return { ast: parseCk(text, filePath, new DiagnosticCollector()), version: 1 };
}

describe('getCodeLenses', () => {
    it('emits a lens above each model declaration with reference count', () => {
        const userSrc = `\
contract User: { name: string }
`;
        const mainSrc = `\
contract Wrapper: { user: User, alt: User }
`;
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);
        index.indexFromSource('file:///main.ck', mainSrc);

        const userParsed = parsed('file:///user.ck', userSrc);
        const lenses = getCodeLenses({ textDocument: { uri: 'file:///user.ck' } }, userParsed, index);
        expect(lenses).toHaveLength(1);
        expect(lenses[0]!.command?.title).toBe('2 references');
    });

    it('does not emit lenses for declarations from other files', () => {
        const userSrc = 'contract User: { name: string }\n';
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);

        // Document is a *different* file that references User but doesn't declare it.
        const mainSrc = 'contract Wrapper: { u: User }\n';
        index.indexFromSource('file:///main.ck', mainSrc);
        const mainParsed = parsed('file:///main.ck', mainSrc);
        const lenses = getCodeLenses({ textDocument: { uri: 'file:///main.ck' } }, mainParsed, index);
        // Only Wrapper's lens — and it has 0 refs (no other file mentions Wrapper)
        expect(lenses).toHaveLength(1);
        expect(lenses[0]!.command?.title).toBe('0 references');
    });

    it('emits a lens for service declarations', () => {
        const src = `\
options {
    services: {
        Svc: "#x.js"
    }
}

operation /a: { get: { service: Svc.list } }
`;
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///ops.ck', src);
        const opsParsed = parsed('file:///ops.ck', src);
        const lenses = getCodeLenses({ textDocument: { uri: 'file:///ops.ck' } }, opsParsed, index);
        expect(lenses.find(l => l.command?.title === '1 reference')).toBeDefined();
    });
});

describe('resolveCodeLens', () => {
    it('attaches the editor.action.showReferences command with location list', () => {
        const userSrc = `\
contract User: { name: string }
contract M: { u: User }
`;
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', userSrc);
        const userParsed = parsed('file:///user.ck', userSrc);
        const [lens] = getCodeLenses({ textDocument: { uri: 'file:///user.ck' } }, userParsed, index);

        const resolved = resolveCodeLens(lens!, index);
        expect(resolved.command?.command).toBe('editor.action.showReferences');
        const args = resolved.command?.arguments as unknown[];
        expect(args[0]).toBe('file:///user.ck');
        const locations = args[2] as Array<{ uri: string }>;
        expect(locations).toHaveLength(1);
        expect(locations[0]!.uri).toBe('file:///user.ck');
    });
});
