import { WorkspaceIndex } from '../src/server/workspace-index.js';

describe('WorkspaceIndex', () => {
    describe('indexFromSource - contracts', () => {
        it('indexes model names from contract source', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///test.ck', 'contract User: { name: string }');
            expect(index.getAllModelNames()).toContain('User');
        });

        it('indexes multiple models from one file', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource(
                'file:///test.ck',
                `\
contract User: { name: string }
contract Admin: User & { role: string }
`,
            );
            expect(index.getAllModelNames()).toContain('User');
            expect(index.getAllModelNames()).toContain('Admin');
        });

        it('returns model entry with correct fields', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
            const entry = index.getModel('User');
            expect(entry).toBeDefined();
            expect(entry!.uri).toBe('file:///user.ck');
            expect(entry!.model.name).toBe('User');
            expect(entry!.model.fields).toHaveLength(1);
        });
    });

    describe('indexFromSource - operations', () => {
        it('indexes route paths from operation source', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///test.ck', 'operation /users: { get: {} }');
            expect(index.getRoute('/users')).toBeDefined();
        });

        it('indexes service names from operation source', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource(
                'file:///test.ck',
                `\
operation /users: {
    put: {
        service: UserService.update
    }
}`,
            );
            expect(index.getAllServiceNames()).toContain('UserService.update');
        });
    });

    describe('removeFile', () => {
        it('removes old entries when re-indexing a file', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///test.ck', 'contract OldModel: { name: string }');
            index.indexFromSource('file:///test.ck', 'contract NewModel: { name: string }');
            expect(index.getAllModelNames()).not.toContain('OldModel');
            expect(index.getAllModelNames()).toContain('NewModel');
        });

        it('removes routes and services on file removal', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///test.ck', 'operation /users: { get: { service: Svc.list } }');
            expect(index.getRoute('/users')).toBeDefined();
            expect(index.getAllServiceNames()).toContain('Svc.list');

            index.removeFile('file:///test.ck');
            expect(index.getRoute('/users')).toBeUndefined();
            expect(index.getAllServiceNames()).toHaveLength(0);
        });
    });

    describe('handles invalid source gracefully', () => {
        it('does not crash on malformed source', () => {
            const index = new WorkspaceIndex();
            // Should not throw even with malformed input
            expect(() => index.indexFromSource('file:///bad.ck', '@@@ totally invalid $$$')).not.toThrow();
        });

        it('does not crash on empty source', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///bad.ck', 'not-a-valid-thing');
            // Should not throw
        });
    });
});
