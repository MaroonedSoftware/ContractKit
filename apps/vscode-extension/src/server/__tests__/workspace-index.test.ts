import { WorkspaceIndex } from '../workspace-index.js';

describe('WorkspaceIndex', () => {
  describe('indexFromSource - DTO', () => {
    it('indexes model names from .dto source', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.dto', 'User { name: string }');
      expect(index.getAllModelNames()).toContain('User');
    });

    it('indexes multiple models from one file', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.dto', `\
User { name: string }
Admin: User { role: string }
`);
      expect(index.getAllModelNames()).toContain('User');
      expect(index.getAllModelNames()).toContain('Admin');
    });

    it('returns model entry with correct fields', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///user.dto', 'User { name: string }');
      const entry = index.getModel('User');
      expect(entry).toBeDefined();
      expect(entry!.uri).toBe('file:///user.dto');
      expect(entry!.model.name).toBe('User');
      expect(entry!.model.fields).toHaveLength(1);
    });
  });

  describe('indexFromSource - OP', () => {
    it('indexes route paths from .op source', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.op', '/users { get: {} }');
      expect(index.getRoute('/users')).toBeDefined();
    });

    it('indexes service names from .op source', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.op', `\
/users {
    put: {
        service: UserService.update
    }
}`);
      expect(index.getAllServiceNames()).toContain('UserService.update');
    });
  });

  describe('removeFile', () => {
    it('removes old entries when re-indexing a file', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.dto', 'OldModel { name: string }');
      index.indexFromSource('file:///test.dto', 'NewModel { name: string }');
      expect(index.getAllModelNames()).not.toContain('OldModel');
      expect(index.getAllModelNames()).toContain('NewModel');
    });

    it('removes routes and services on file removal', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///test.op', '/users { get: { service: Svc.list } }');
      expect(index.getRoute('/users')).toBeDefined();
      expect(index.getAllServiceNames()).toContain('Svc.list');

      index.removeFile('file:///test.op');
      expect(index.getRoute('/users')).toBeUndefined();
      expect(index.getAllServiceNames()).toHaveLength(0);
    });
  });

  describe('handles invalid source gracefully', () => {
    it('does not crash on malformed .dto source', () => {
      const index = new WorkspaceIndex();
      // Should not throw even with malformed input
      expect(() => index.indexFromSource('file:///bad.dto', '@@@ totally invalid $$$')).not.toThrow();
    });

    it('does not crash on malformed .op source', () => {
      const index = new WorkspaceIndex();
      index.indexFromSource('file:///bad.op', 'not-a-route');
      // Should not throw
    });
  });
});
