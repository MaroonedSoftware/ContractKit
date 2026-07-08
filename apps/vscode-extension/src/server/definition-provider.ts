import { Location, Range, TextDocumentPositionParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { WorkspaceIndex } from './workspace-index.js';
import { getWordAtPosition } from '../shared/word-at-position.js';

export function getDefinition(params: TextDocumentPositionParams, document: TextDocument, index: WorkspaceIndex): Location | null {
    const hit = getWordAtPosition(document, params.position.line, params.position.character);
    if (!hit) return null;
    const word = hit.word;

    const modelEntry = index.getModel(word);
    if (modelEntry) {
        const line = Math.max(0, modelEntry.line - 1);
        return {
            uri: modelEntry.uri,
            range: Range.create(line, modelEntry.column, line, modelEntry.column + word.length),
        };
    }

    const serviceDecl = index.getServiceDecl(word);
    if (serviceDecl) {
        const line = Math.max(0, serviceDecl.line - 1);
        return {
            uri: serviceDecl.uri,
            range: Range.create(line, serviceDecl.column, line, serviceDecl.column + word.length),
        };
    }

    return null;
}
