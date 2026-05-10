import { Diagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCodeActions } from '../src/server/code-action-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

function makeDoc(uri: string, content: string) {
    return TextDocument.create(uri, 'contract-ck', 1, content);
}

function diag(line: number, message: string, code: string): Diagnostic {
    return {
        range: Range.create(line, 0, line, 100),
        message,
        severity: DiagnosticSeverity.Error,
        source: 'contractkit',
        code,
    };
}

describe('getCodeActions', () => {
    it('offers an `Add override` quick-fix for missing-override diagnostics', () => {
        const src = `\
contract A: { name: string }
contract B: { name: int }
contract C: A & B & {
    name: string
}
`;
        const doc = makeDoc('file:///x.ck', src);
        const d = diag(3, "Field 'name' conflicts across bases 'A' and 'B' — mark as 'override'", 'missing-override');
        const actions = getCodeActions(
            { textDocument: { uri: doc.uri }, range: d.range, context: { diagnostics: [d] } },
            doc,
            new WorkspaceIndex(),
        );
        expect(actions).toHaveLength(1);
        const edits = actions[0]!.edit?.changes?.[doc.uri];
        expect(edits).toBeDefined();
        expect(edits![0]!.newText).toBe('override ');
        expect(edits![0]!.range.start).toEqual({ line: 3, character: 4 });
    });

    it('offers a `Remove override` quick-fix for spurious-override diagnostics', () => {
        const src = `\
contract A: {
    override foo: string
}
`;
        const doc = makeDoc('file:///x.ck', src);
        const d = diag(1, "Field 'foo' has 'override' but is not declared in any base of 'A'", 'spurious-override');
        const actions = getCodeActions(
            { textDocument: { uri: doc.uri }, range: d.range, context: { diagnostics: [d] } },
            doc,
            new WorkspaceIndex(),
        );
        expect(actions).toHaveLength(1);
        const edit = actions[0]!.edit?.changes?.[doc.uri]?.[0];
        expect(edit?.newText).toBe('');
        expect(edit?.range).toEqual({ start: { line: 1, character: 4 }, end: { line: 1, character: 13 } });
    });

    it('offers fuzzy-match suggestions for unknown-model diagnostics', () => {
        const index = new WorkspaceIndex();
        index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
        const src = 'contract M: { u: Usr }\n';
        const doc = makeDoc('file:///main.ck', src);
        const d = diag(0, 'Referenced model "Usr" is not defined in any contract file', 'unknown-model');
        const actions = getCodeActions(
            { textDocument: { uri: doc.uri }, range: d.range, context: { diagnostics: [d] } },
            doc,
            index,
        );
        expect(actions.some(a => a.title === "Replace 'Usr' with 'User'")).toBe(true);
    });

    it('returns no actions for diagnostics without a `code`', () => {
        const doc = makeDoc('file:///x.ck', 'contract X: { f: string }');
        const d: Diagnostic = { range: Range.create(0, 0, 0, 10), message: 'something', severity: DiagnosticSeverity.Error };
        const actions = getCodeActions(
            { textDocument: { uri: doc.uri }, range: d.range, context: { diagnostics: [d] } },
            doc,
            new WorkspaceIndex(),
        );
        expect(actions).toEqual([]);
    });
});
