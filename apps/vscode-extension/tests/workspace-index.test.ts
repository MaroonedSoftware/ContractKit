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

        it('records the column where the model name starts on its declaration line', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///user.ck', '# leading comment\ncontract User: { name: string }');
            const entry = index.getModel('User');
            expect(entry!.line).toBe(2);
            expect(entry!.column).toBe('contract '.length);
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

        it('indexes service declarations from options.services', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource(
                'file:///test.ck',
                `\
options {
    services: {
        PaymentsService: "#src/services/payments.service.js"
    }
}
`,
            );
            const decl = index.getServiceDecl('PaymentsService');
            expect(decl).toBeDefined();
            expect(decl!.uri).toBe('file:///test.ck');
            expect(decl!.line).toBe(3);
            expect(decl!.column).toBe(8);
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

        it('removes service declarations on file removal', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource(
                'file:///test.ck',
                `\
options {
    services: {
        Svc: "#src/svc.js"
    }
}
`,
            );
            expect(index.getServiceDecl('Svc')).toBeDefined();
            index.removeFile('file:///test.ck');
            expect(index.getServiceDecl('Svc')).toBeUndefined();
        });
    });

    describe('reference index', () => {
        it('records cross-file model references with line/column', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
            index.indexFromSource('file:///main.ck', 'contract M: {\n    u: User\n}\n');
            const refs = index.getModelReferences('User');
            expect(refs).toHaveLength(1);
            expect(refs[0]).toMatchObject({ uri: 'file:///main.ck', line: 2, length: 4 });
            expect(refs[0]!.column).toBe('    u: '.length);
        });

        it('flags the declaration site and excludes it by default', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///user.ck', 'contract User: { name: string }\ncontract M: { u: User }');
            expect(index.getModelReferences('User')).toHaveLength(1);
            const all = index.getModelReferences('User', true);
            expect(all.some(r => r.isDeclaration)).toBe(true);
        });

        it('does not record references inside string literals or after `#`', () => {
            const index = new WorkspaceIndex();
            const src = `\
contract User: { name: string }
contract M: {
    note: string = "User in a string"
    # not a User reference here
}
`;
            index.indexFromSource('file:///main.ck', src);
            const refs = index.getModelReferences('User');
            expect(refs).toEqual([]);
        });

        it('records service references and excludes the declaration', () => {
            const index = new WorkspaceIndex();
            const src = `\
options {
    services: {
        Svc: "#x.js"
    }
}

operation /a: { get: { service: Svc.list } }
operation /b: { get: { service: Svc.find } }
`;
            index.indexFromSource('file:///ops.ck', src);
            const refs = index.getServiceReferences('Svc');
            expect(refs).toHaveLength(2);
        });

        it('drops references for a removed file', () => {
            const index = new WorkspaceIndex();
            index.indexFromSource('file:///user.ck', 'contract User: { name: string }');
            index.indexFromSource('file:///main.ck', 'contract M: { u: User }');
            expect(index.getModelReferences('User')).toHaveLength(1);
            index.removeFile('file:///main.ck');
            expect(index.getModelReferences('User')).toEqual([]);
        });

        it('bumps version on every index/remove', () => {
            const index = new WorkspaceIndex();
            const v0 = index.version();
            index.indexFromSource('file:///x.ck', 'contract X: { f: string }');
            expect(index.version()).toBeGreaterThan(v0);
            const v1 = index.version();
            index.removeFile('file:///x.ck');
            expect(index.version()).toBeGreaterThan(v1);
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
