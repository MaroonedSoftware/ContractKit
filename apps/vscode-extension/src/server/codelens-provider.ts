import { CodeLens, CodeLensParams, Location, Position, Range } from 'vscode-languageserver';
import type { ParsedDocument } from './document-manager.js';
import type { WorkspaceIndex } from './workspace-index.js';

/** Light-weight CodeLens stubs — counts only. The actual reference list is computed in `resolveCodeLens`. */
export function getCodeLenses(params: CodeLensParams, parsed: ParsedDocument, index: WorkspaceIndex): CodeLens[] {
    const lenses: CodeLens[] = [];
    const uri = params.textDocument.uri;

    for (const model of parsed.ast.models) {
        const decl = index.getModel(model.name);
        if (!decl || decl.uri !== uri) continue;
        const refs = index.getModelReferences(model.name, false);
        lenses.push(stubLens(uri, decl.line, decl.column, model.name, 'model', refs.length));
    }

    if (parsed.ast.services) {
        for (const serviceName of Object.keys(parsed.ast.services)) {
            const decl = index.getServiceDecl(serviceName);
            if (!decl || decl.uri !== uri) continue;
            const refs = index.getServiceReferences(serviceName, false);
            lenses.push(stubLens(uri, decl.line, decl.column, serviceName, 'service', refs.length));
        }
    }

    return lenses;
}

/** Hydrate a stub CodeLens with the actual `editor.action.showReferences` command. */
export function resolveCodeLens(lens: CodeLens, index: WorkspaceIndex): CodeLens {
    const data = lens.data as LensData | undefined;
    if (!data) return lens;
    const refs = data.kind === 'model' ? index.getModelReferences(data.name, false) : index.getServiceReferences(data.name, false);
    const locations: Location[] = refs.map(r => ({
        uri: r.uri,
        range: Range.create(r.line - 1, r.column, r.line - 1, r.column + r.length),
    }));
    lens.command = {
        title: refs.length === 1 ? '1 reference' : `${refs.length} references`,
        command: 'editor.action.showReferences',
        arguments: [data.uri, Position.create(data.declLine - 1, data.declColumn), locations],
    };
    return lens;
}

interface LensData {
    name: string;
    kind: 'model' | 'service';
    uri: string;
    declLine: number;
    declColumn: number;
}

function stubLens(uri: string, line: number, column: number, name: string, kind: 'model' | 'service', count: number): CodeLens {
    const data: LensData = { name, kind, uri, declLine: line, declColumn: column };
    return {
        range: Range.create(line - 1, column, line - 1, column + name.length),
        // Cheap pre-resolved title so the lens doesn't flicker. `resolveCodeLens` re-computes it
        // with the live count and attaches the actual `showReferences` command.
        command: {
            title: count === 1 ? '1 reference' : `${count} references`,
            command: '',
        },
        data,
    };
}

