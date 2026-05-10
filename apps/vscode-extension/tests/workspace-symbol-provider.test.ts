import { SymbolKind } from 'vscode-languageserver';
import { getWorkspaceSymbols } from '../src/server/workspace-symbol-provider.js';
import { WorkspaceIndex } from '../src/server/workspace-index.js';

describe('getWorkspaceSymbols', () => {
    function makeIndex() {
        const index = new WorkspaceIndex();
        index.indexFromSource(
            'file:///user.ck',
            `\
contract User: { name: string }
contract Admin: User & { role: string }
`,
        );
        index.indexFromSource(
            'file:///ops.ck',
            `\
options {
    services: {
        PaymentsService: "#src/services/payments.service.js"
    }
}

operation /payments: {
    get: { service: PaymentsService.list }
}
`,
        );
        return index;
    }

    it('returns all models, routes, and service decls when query is empty', () => {
        const symbols = getWorkspaceSymbols({ query: '' }, makeIndex());
        const names = symbols.map(s => s.name);
        expect(names).toEqual(expect.arrayContaining(['User', 'Admin', '/payments', 'PaymentsService']));
    });

    it('filters by case-insensitive substring', () => {
        const symbols = getWorkspaceSymbols({ query: 'pay' }, makeIndex());
        const names = symbols.map(s => s.name);
        expect(names).toEqual(expect.arrayContaining(['/payments', 'PaymentsService']));
        expect(names).not.toContain('User');
    });

    it('classifies models as Class, services as Interface, routes as Module', () => {
        const symbols = getWorkspaceSymbols({ query: '' }, makeIndex());
        expect(symbols.find(s => s.name === 'User')?.kind).toBe(SymbolKind.Class);
        expect(symbols.find(s => s.name === 'PaymentsService')?.kind).toBe(SymbolKind.Interface);
        expect(symbols.find(s => s.name === '/payments')?.kind).toBe(SymbolKind.Module);
    });

    it('locations point to the declaration with precise column for models', () => {
        const symbols = getWorkspaceSymbols({ query: 'User' }, makeIndex());
        const user = symbols.find(s => s.name === 'User')!;
        expect(user.location.uri).toBe('file:///user.ck');
        expect(user.location.range.start).toEqual({ line: 0, character: 'contract '.length });
    });
});
