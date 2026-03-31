import { TextDocument } from 'vscode-languageserver-textdocument';
import { getCompletions } from '../completion-provider.js';
import { WorkspaceIndex } from '../workspace-index.js';

function makeDoc(uri: string, content: string) {
  return TextDocument.create(uri, 'contract-ck', 1, content);
}

describe('getCompletions', () => {
  describe('contract completions', () => {
    it('offers type completions after colon in contract', () => {
      const doc = makeDoc('file:///test.ck', 'contract M: {\n    name: \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 10 } }, doc, index);
      expect(items.some(i => i.label === 'string')).toBe(true);
      expect(items.some(i => i.label === 'number')).toBe(true);
      expect(items.some(i => i.label === 'array')).toBe(true);
    });

    it('offers model names from index in type position', () => {
      const doc = makeDoc('file:///test.ck', 'contract M: {\n    ref: \n}');
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///other.ck', 'contract User: { name: string }');
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 9 } }, doc, index);
      expect(items.some(i => i.label === 'User')).toBe(true);
    });

    it('offers type completions after ampersand (intersection)', () => {
      const doc = makeDoc('file:///test.ck', 'contract M: {\n    f: string & \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 15 } }, doc, index);
      expect(items.some(i => i.label === 'string')).toBe(true);
      expect(items.some(i => i.label === 'number')).toBe(true);
      expect(items.some(i => i.label === 'null')).toBe(true);
      expect(items.some(i => i.label === 'array')).toBe(true);
    });

    it('offers type completions after pipe (union)', () => {
      const doc = makeDoc('file:///test.ck', 'contract M: {\n    f: string | \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 15 } }, doc, index);
      expect(items.some(i => i.label === 'string')).toBe(true);
      expect(items.some(i => i.label === 'null')).toBe(true);
      expect(items.some(i => i.label === 'array')).toBe(true);
    });
  });

  describe('operation completions', () => {
    it('offers HTTP methods inside route body', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 4 } }, doc, index);
      expect(items.some(i => i.label === 'get')).toBe(true);
      expect(items.some(i => i.label === 'post')).toBe(true);
    });

    it('offers block keywords inside route body', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    \n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 4 } }, doc, index);
      expect(items.some(i => i.label === 'params')).toBe(true);
    });

    it('offers builtin and compound types after query:', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        query: \n    }\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 2, character: 15 } }, doc, index);
      expect(items.some(i => i.label === 'string')).toBe(true);
      expect(items.some(i => i.label === 'int')).toBe(true);
      expect(items.some(i => i.label === 'array')).toBe(true);
    });

    it('offers service names after service:', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        service: \n    }\n}');
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///other.ck', 'operation /test: {\n    get: {\n        service: UserService.list\n    }\n}');
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 2, character: 17 } }, doc, index);
      // Service names come from the index
      expect(items.every(i => i.kind === 3 /* Function */)).toBe(true);
    });

    it('offers security keyword in operation body', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        \n    }\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 2, character: 8 } }, doc, index);
      expect(items.some(i => i.label === 'security')).toBe(true);
    });

    it('offers only none after security: (inline public form)', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        security: \n    }\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 2, character: 18 } }, doc, index);
      expect(items.some(i => i.label === 'none')).toBe(true);
      expect(items.some(i => i.label === 'bearer')).toBe(false);
      expect(items.some(i => i.label === 'apiKey')).toBe(false);
    });

    it('offers scheme names inside security block (not none)', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        security {\n            \n        }\n    }\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 3, character: 12 } }, doc, index);
      expect(items.some(i => i.label === 'bearer')).toBe(true);
      expect(items.some(i => i.label === 'apiKey')).toBe(true);
      expect(items.some(i => i.label === 'none')).toBe(false);
    });
  });

  describe('modifier completions', () => {
    it('offers internal and deprecated inside operation( at top-level', () => {
      const doc = makeDoc('file:///test.ck', 'operation(');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 0, character: 10 } }, doc, index);
      expect(items.some(i => i.label === 'internal')).toBe(true);
      expect(items.some(i => i.label === 'deprecated')).toBe(true);
    });

    it('offers partial match inside operation(int...', () => {
      const doc = makeDoc('file:///test.ck', 'operation(int');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 0, character: 13 } }, doc, index);
      expect(items.some(i => i.label === 'internal')).toBe(true);
      expect(items.some(i => i.label === 'deprecated')).toBe(true);
    });

    it('offers internal, deprecated, public inside verb( in route-body', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get(\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 1, character: 8 } }, doc, index);
      expect(items.some(i => i.label === 'internal')).toBe(true);
      expect(items.some(i => i.label === 'deprecated')).toBe(true);
      expect(items.some(i => i.label === 'public')).toBe(true);
    });

    it('does not offer route modifiers in operation body (wrong context)', () => {
      const doc = makeDoc('file:///test.ck', 'operation /users: {\n    get: {\n        \n    }\n}');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 2, character: 8 } }, doc, index);
      expect(items.some(i => i.label === 'security')).toBe(true);
      expect(items.some(i => i.label === 'service')).toBe(true);
      expect(items.some(i => i.label === 'internal')).toBe(false);
      expect(items.some(i => i.label === 'deprecated')).toBe(false);
    });

    it('route modifier completions are kind Keyword', () => {
      const doc = makeDoc('file:///test.ck', 'operation(');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 0, character: 10 } }, doc, index);
      const internalItem = items.find(i => i.label === 'internal');
      const deprecatedItem = items.find(i => i.label === 'deprecated');
      expect(internalItem).toBeDefined();
      expect(deprecatedItem).toBeDefined();
      expect(internalItem?.kind).toBe(14 /* Keyword */);
      expect(deprecatedItem?.kind).toBe(14 /* Keyword */);
    });
  });

  describe('top-level completions', () => {
    it('offers contract, operation, and options at top level', () => {
      const doc = makeDoc('file:///test.ck', '');
      const index = new WorkspaceIndex();
      const items = getCompletions({ textDocument: { uri: doc.uri }, position: { line: 0, character: 0 } }, doc, index);
      expect(items.some(i => i.label === 'contract')).toBe(true);
      expect(items.some(i => i.label === 'operation')).toBe(true);
      expect(items.some(i => i.label === 'options')).toBe(true);
    });
  });
});
