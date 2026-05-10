import { FoldingRange, FoldingRangeKind, FoldingRangeParams } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function getFoldingRanges(_params: FoldingRangeParams, document: TextDocument): FoldingRange[] {
    const text = document.getText();
    const lines = text.split('\n');
    const ranges: FoldingRange[] = [];

    // Brace stack tracks the line number where each `{` was opened. Strings and `#` comments are skipped.
    const openLines: number[] = [];

    // Comment regions: a run of consecutive `#` lines folds as one block.
    let commentStart: number | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trimStart();

        if (trimmed.startsWith('#')) {
            if (commentStart === null) commentStart = i;
        } else {
            if (commentStart !== null && i - 1 > commentStart) {
                ranges.push({ startLine: commentStart, endLine: i - 1, kind: FoldingRangeKind.Comment });
            }
            commentStart = null;
        }

        for (let j = 0; j < line.length; j++) {
            const ch = line[j]!;
            if (ch === '#') break; // rest is a line comment
            if (ch === '"') {
                // Skip past the string literal
                j++;
                while (j < line.length && line[j] !== '"') {
                    if (line[j] === '\\') j++;
                    j++;
                }
                continue;
            }
            if (ch === '{') {
                openLines.push(i);
            } else if (ch === '}') {
                const startLine = openLines.pop();
                if (startLine !== undefined && i > startLine) {
                    ranges.push({ startLine, endLine: i - 1 });
                }
            }
        }
    }

    if (commentStart !== null && lines.length - 1 > commentStart) {
        ranges.push({ startLine: commentStart, endLine: lines.length - 1, kind: FoldingRangeKind.Comment });
    }

    return ranges;
}
