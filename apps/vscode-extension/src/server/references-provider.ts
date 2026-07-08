import { DocumentHighlight, DocumentHighlightKind, DocumentHighlightParams, Location, Range, ReferenceParams, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Reference, WorkspaceIndex } from './workspace-index.js';
import { getWordAtPosition } from '../shared/word-at-position.js';

/** All reference Locations for the identifier under the cursor (across the workspace). */
export function getReferences(params: ReferenceParams, document: TextDocument, index: WorkspaceIndex): Location[] {
    const refs = lookupReferencesAtPosition(params, document, index, params.context?.includeDeclaration ?? false);
    return refs.map(r => ({
        uri: r.uri,
        range: Range.create(r.line - 1, r.column, r.line - 1, r.column + r.length),
    }));
}

/** Same lookup, scoped to the current document — for VS Code's "highlight occurrences" UX. */
export function getDocumentHighlights(params: DocumentHighlightParams, document: TextDocument, index: WorkspaceIndex): DocumentHighlight[] {
    const refs = lookupReferencesAtPosition(params, document, index, true);
    return refs
        .filter(r => r.uri === document.uri)
        .map(r => ({
            range: Range.create(r.line - 1, r.column, r.line - 1, r.column + r.length),
            kind: r.isDeclaration ? DocumentHighlightKind.Write : DocumentHighlightKind.Read,
        }));
}

function lookupReferencesAtPosition(
    params: TextDocumentPositionParams,
    document: TextDocument,
    index: WorkspaceIndex,
    includeDeclaration: boolean,
): Reference[] {
    const hit = getWordAtPosition(document, params.position.line, params.position.character);
    if (!hit) return [];
    const word = hit.word;
    const modelRefs = index.getModelReferences(word, includeDeclaration);
    if (modelRefs.length > 0) return modelRefs;
    const serviceRefs = index.getServiceReferences(word, includeDeclaration);
    return serviceRefs;
}
