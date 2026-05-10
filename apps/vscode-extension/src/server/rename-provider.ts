import { PrepareRenameParams, Range, RenameParams, ResponseError, TextEdit, WorkspaceEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Reference, WorkspaceIndex } from './workspace-index.js';

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface SymbolHit {
    name: string;
    kind: 'model' | 'service';
    range: Range;
}

/** LSP `prepareRename`: confirm cursor is on a known identifier and tell the editor what range to highlight. */
export function prepareRename(params: PrepareRenameParams, document: TextDocument, index: WorkspaceIndex): Range | ResponseError<void> | null {
    const hit = symbolUnderCursor(document, params.position.line, params.position.character, index);
    if (!hit) return null;
    return hit.range;
}

/** LSP `rename`: emit a WorkspaceEdit that rewrites every reference site (including the declaration). */
export function getRenameEdits(params: RenameParams, document: TextDocument, index: WorkspaceIndex): WorkspaceEdit | ResponseError<void> | null {
    const hit = symbolUnderCursor(document, params.position.line, params.position.character, index);
    if (!hit) return null;
    const newName = params.newName.trim();
    if (!IDENT_RE.test(newName)) {
        return new ResponseError(0, `'${params.newName}' is not a valid ContractKit identifier`);
    }
    if (newName === hit.name) return { changes: {} };
    if (collidesWithExisting(newName, hit.kind, index)) {
        return new ResponseError(0, `A ${hit.kind} named '${newName}' already exists`);
    }

    const refs = hit.kind === 'model' ? index.getModelReferences(hit.name, true) : index.getServiceReferences(hit.name, true);
    const changes: Record<string, TextEdit[]> = {};
    for (const ref of refs) {
        const edits = (changes[ref.uri] ??= []);
        edits.push(TextEdit.replace(toRange(ref), newName));
    }
    return { changes };
}

function toRange(ref: Reference): Range {
    return Range.create(ref.line - 1, ref.column, ref.line - 1, ref.column + ref.length);
}

function symbolUnderCursor(document: TextDocument, line: number, character: number, index: WorkspaceIndex): SymbolHit | null {
    const text = document.getText();
    const lines = text.split('\n');
    if (line >= lines.length) return null;
    const lineText = lines[line]!;
    if (character > lineText.length) return null;

    let start = character;
    while (start > 0 && /[A-Za-z0-9_]/.test(lineText[start - 1]!)) start--;
    let end = character;
    while (end < lineText.length && /[A-Za-z0-9_]/.test(lineText[end]!)) end++;
    if (start === end) return null;
    const word = lineText.slice(start, end);
    const range = Range.create(line, start, line, end);

    if (index.getModel(word)) return { name: word, kind: 'model', range };
    if (index.getServiceDecl(word)) return { name: word, kind: 'service', range };
    return null;
}

function collidesWithExisting(newName: string, kind: 'model' | 'service', index: WorkspaceIndex): boolean {
    if (kind === 'model') return !!index.getModel(newName);
    return !!index.getServiceDecl(newName);
}
