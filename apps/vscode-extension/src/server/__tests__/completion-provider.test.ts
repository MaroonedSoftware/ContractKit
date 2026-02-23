import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletions } from '../completion-provider.js';
import { WorkspaceIndex } from '../workspace-index.js';

function makeDoc(uri: string, content: string) {
  return TextDocument.create(uri, uri.endsWith('.dto') ? 'dto' : 'op', 1, content);
}

describe('getCompletions', () => {
  describe('DTO completions', () => {
    it('offers type completions after colon in .dto file', () => {
      const doc = makeDoc('file:///test.dto', 'M {\n    name: \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions(
        { textDocument: { uri: doc.uri }, position: { line: 1, character: 10 } },
        doc, index,
      );
      expect(items.some(i => i.label === 'string')).toBe(true);
      expect(items.some(i => i.label === 'number')).toBe(true);
      expect(items.some(i => i.label === 'array')).toBe(true);
    });

    it('offers model names from index in type position', () => {
      const doc = makeDoc('file:///test.dto', 'M {\n    ref: \n}');
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///other.dto', 'User { name: string }');
      const items = getCompletions(
        { textDocument: { uri: doc.uri }, position: { line: 1, character: 9 } },
        doc, index,
      );
      expect(items.some(i => i.label === 'User')).toBe(true);
    });
  });

  describe('OP completions', () => {
    it('offers HTTP methods inside route body in .op file', () => {
      const doc = makeDoc('file:///test.op', '/users {\n    \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions(
        { textDocument: { uri: doc.uri }, position: { line: 1, character: 4 } },
        doc, index,
      );
      expect(items.some(i => i.label === 'get')).toBe(true);
      expect(items.some(i => i.label === 'post')).toBe(true);
    });

    it('offers block keywords inside route body', () => {
      const doc = makeDoc('file:///test.op', '/users {\n    \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions(
        { textDocument: { uri: doc.uri }, position: { line: 1, character: 4 } },
        doc, index,
      );
      expect(items.some(i => i.label === 'params')).toBe(true);
    });
  });
});
