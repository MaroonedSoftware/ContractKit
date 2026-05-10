import { DocumentHighlight, DocumentHighlightKind, DocumentHighlightParams, Location, Range, ReferenceParams, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Reference, WorkspaceIndex } from './workspace-index.js';

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
    const word = getWordAtPosition(document, params.position.line, params.position.character);
    if (!word) return [];
    const modelRefs = index.getModelReferences(word, includeDeclaration);
    if (modelRefs.length > 0) return modelRefs;
    const serviceRefs = index.getServiceReferences(word, includeDeclaration);
    return serviceRefs;
}

function getWordAtPosition(document: TextDocument, line: number, character: number): string | null {
    const text = document.getText();
    const lines = text.split('\n');
    if (line >= lines.length) return null;
    const lineText = lines[line]!;
    if (character >= lineText.length) return null;

    let start = character;
    while (start > 0 && /[a-zA-Z0-9_$]/.test(lineText[start - 1]!)) start--;
    let end = character;
    while (end < lineText.length && /[a-zA-Z0-9_$]/.test(lineText[end]!)) end++;
    if (start === end) return null;
    return lineText.slice(start, end);
}
