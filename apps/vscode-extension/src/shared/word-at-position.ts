import { TextDocument } from 'vscode-languageserver-textdocument';

/** The identifier under the cursor plus the column span it occupies on its line. */
export interface WordAtPosition {
    word: string;
    /** Zero-based start column of the word on `line`. */
    start: number;
    /** Zero-based column one past the last character of the word. */
    end: number;
}

/** Characters that form part of a ContractKit identifier for word-boundary scanning. */
const WORD_CHAR = /[A-Za-z0-9_$]/;

/**
 * Resolve the identifier straddling `(line, character)`, or `null` when the cursor is not on one.
 *
 * A cursor at `character === lineText.length` (immediately after the final token on a line) is a
 * valid position and resolves the trailing identifier — hence the `> lineText.length` bound rather
 * than `>=`. Shared by the hover, definition, references, and rename providers.
 */
export function getWordAtPosition(document: TextDocument, line: number, character: number): WordAtPosition | null {
    const lines = document.getText().split('\n');
    if (line >= lines.length) return null;

    const lineText = lines[line]!;
    if (character > lineText.length) return null;

    let start = character;
    while (start > 0 && WORD_CHAR.test(lineText[start - 1]!)) start--;
    let end = character;
    while (end < lineText.length && WORD_CHAR.test(lineText[end]!)) end++;

    if (start === end) return null;
    return { word: lineText.slice(start, end), start, end };
}
