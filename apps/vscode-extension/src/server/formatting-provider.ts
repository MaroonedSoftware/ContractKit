import { DocumentFormattingParams, Range, TextEdit } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parseCk, DiagnosticCollector } from '@contractkit/core';
import { printCk, DEFAULT_PRINT_WIDTH } from '@contractkit/prettier-plugin';

export function getFormattingEdits(_params: DocumentFormattingParams, document: TextDocument): TextEdit[] {
    const text = document.getText();
    const diag = new DiagnosticCollector();
    let formatted: string;
    try {
        const ast = parseCk(text, '<lsp>', diag);
        if (diag.hasErrors()) return [];
        formatted = printCk(ast, DEFAULT_PRINT_WIDTH);
        if (!formatted.endsWith('\n')) formatted += '\n';
    } catch {
        return [];
    }

    if (formatted === text) return [];

    const fullRange = Range.create(document.positionAt(0), document.positionAt(text.length));
    return [TextEdit.replace(fullRange, formatted)];
}
