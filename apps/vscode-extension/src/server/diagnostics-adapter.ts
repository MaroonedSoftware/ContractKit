import { Diagnostic as LspDiagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from '@contractkit/core';

/** Convert core diagnostics into LSP diagnostics, spanning each report from column 0 to the
 * line's actual length. `text` is the document the diagnostics were produced from — it is used
 * to bound the range so `Range.create` doesn't reject character positions that exceed LSP's
 * `uinteger` limit. Out-of-range lines are clamped to the last line of the document. */
export function toLspDiagnostics(diagnostics: Diagnostic[], text: string): LspDiagnostic[] {
    const lines = text.split(/\r\n|\r|\n/);
    const lastLineIndex = Math.max(0, lines.length - 1);
    return diagnostics.map(d => {
        const line = Math.min(lastLineIndex, Math.max(0, d.line - 1));
        const endChar = lines[line]?.length ?? 0;
        const lsp: LspDiagnostic = {
            severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            range: Range.create(line, 0, line, endChar),
            message: d.message,
            source: 'contractkit',
        };
        if (d.code) lsp.code = d.code;
        return lsp;
    });
}
