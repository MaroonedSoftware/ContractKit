import { Diagnostic as LspDiagnostic, DiagnosticSeverity, Range } from 'vscode-languageserver';
import type { Diagnostic } from 'contract-dsl/src/diagnostics.js';

export function toLspDiagnostics(diagnostics: Diagnostic[]): LspDiagnostic[] {
    return diagnostics.map((d) => {
        const line = Math.max(0, d.line - 1); // Convert 1-based to 0-based
        return {
            severity:
                d.severity === 'error'
                    ? DiagnosticSeverity.Error
                    : DiagnosticSeverity.Warning,
            range: Range.create(line, 0, line, Number.MAX_SAFE_INTEGER),
            message: d.message,
            source: 'contract-dsl',
        };
    });
}
