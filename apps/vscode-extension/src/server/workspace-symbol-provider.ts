import { SymbolInformation, SymbolKind, Location, Range, WorkspaceSymbolParams } from 'vscode-languageserver';
import type { WorkspaceIndex } from './workspace-index.js';

export function getWorkspaceSymbols(params: WorkspaceSymbolParams, index: WorkspaceIndex): SymbolInformation[] {
    const query = params.query.toLowerCase();
    const symbols: SymbolInformation[] = [];

    for (const name of index.getAllModelNames()) {
        if (query && !name.toLowerCase().includes(query)) continue;
        const entry = index.getModel(name);
        if (!entry) continue;
        const line = Math.max(0, entry.line - 1);
        symbols.push({
            name,
            kind: SymbolKind.Class,
            location: Location.create(entry.uri, Range.create(line, entry.column, line, entry.column + name.length)),
        });
    }

    for (const path of index.getAllRoutePaths()) {
        if (query && !path.toLowerCase().includes(query)) continue;
        const entry = index.getRoute(path);
        if (!entry) continue;
        const line = Math.max(0, entry.line - 1);
        symbols.push({
            name: path,
            kind: SymbolKind.Module,
            location: Location.create(entry.uri, Range.create(line, 0, line, path.length)),
        });
    }

    for (const name of index.getAllServiceDeclNames()) {
        if (query && !name.toLowerCase().includes(query)) continue;
        const entry = index.getServiceDecl(name);
        if (!entry) continue;
        const line = Math.max(0, entry.line - 1);
        symbols.push({
            name,
            kind: SymbolKind.Interface,
            location: Location.create(entry.uri, Range.create(line, entry.column, line, entry.column + name.length)),
        });
    }

    return symbols;
}
