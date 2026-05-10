import { Diagnostic as LspDiagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from '@contractkit/core';

export function toLspDiagnostics(diagnostics: Diagnostic[]): LspDiagnostic[] {
    return diagnostics.map(d => {
        const line = Math.max(0, d.line - 1); // Convert 1-based to 0-based
        const lsp: LspDiagnostic = {
            severity: d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            range: Range.create(line, 0, line, Number.MAX_SAFE_INTEGER),
            message: d.message,
            source: 'contractkit',
        };
        if (d.code) lsp.code = d.code;
        return lsp;
    });
}
