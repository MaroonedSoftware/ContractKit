import { DiagnosticSeverity } from 'vscode-languageserver';
import type { Diagnostic } from '@contractkit/core';
import { toLspDiagnostics } from '../src/server/diagnostics-adapter.js';

const UINTEGER_MAX = 2 ** 31;

describe('toLspDiagnostics', () => {
    it('spans the offending line from column 0 to the line length', () => {
        const text = 'contract User: {\n    name: string\n}\n';
        const diags: Diagnostic[] = [
            { file: 'x.ck', line: 2, message: 'bad type', severity: 'error' },
        ];

        const result = toLspDiagnostics(diags, text);

        expect(result).toHaveLength(1);
        expect(result[0].range).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 1, character: '    name: string'.length },
        });
        expect(result[0].severity).toBe(DiagnosticSeverity.Error);
        expect(result[0].message).toBe('bad type');
        expect(result[0].source).toBe('contractkit');
    });

    it('emits a zero-width range on an empty line', () => {
        const text = 'contract User: {\n\n}\n';
        const diags: Diagnostic[] = [
            { file: 'x.ck', line: 2, message: 'empty', severity: 'warning' },
        ];

        const result = toLspDiagnostics(diags, text);

        expect(result[0].range).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 1, character: 0 },
        });
        expect(result[0].severity).toBe(DiagnosticSeverity.Warning);
    });

    it('clamps a line that is past the end of the document to the last line', () => {
        const text = 'a\nb\n';
        const diags: Diagnostic[] = [
            { file: 'x.ck', line: 99, message: 'stale', severity: 'error' },
        ];

        const result = toLspDiagnostics(diags, text);

        expect(result[0].range.start.line).toBe(2);
        expect(result[0].range.end.line).toBe(2);
        expect(result[0].range.end.character).toBe(0);
    });

    it('preserves the optional code field', () => {
        const text = 'contract X: {}\n';
        const diags: Diagnostic[] = [
            { file: 'x.ck', line: 1, message: 'msg', severity: 'error', code: 'CK001' },
        ];

        const result = toLspDiagnostics(diags, text);

        expect(result[0].code).toBe('CK001');
    });

    it('keeps every range end.character within the LSP uinteger limit', () => {
        const text = 'short line\n' + 'x'.repeat(10_000) + '\n';
        const diags: Diagnostic[] = [
            { file: 'x.ck', line: 1, message: 'a', severity: 'error' },
            { file: 'x.ck', line: 2, message: 'b', severity: 'error' },
        ];

        const result = toLspDiagnostics(diags, text);

        for (const d of result) {
            expect(d.range.end.character).toBeLessThan(UINTEGER_MAX);
            expect(Number.isSafeInteger(d.range.end.character)).toBe(true);
        }
    });
});
