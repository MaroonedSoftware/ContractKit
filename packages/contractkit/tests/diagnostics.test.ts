import { DiagnosticCollector } from '../src/diagnostics.js';

describe('DiagnosticCollector', () => {
    // ─── error() / warn() ───────────────────────────────────────────

    describe('error()', () => {
        it('records an error diagnostic', () => {
            const diag = new DiagnosticCollector();
            diag.error('file.dto', 3, 'bad syntax');
            const all = diag.getAll();
            expect(all).toHaveLength(1);
            expect(all[0]).toEqual({
                file: 'file.dto',
                line: 3,
                message: 'bad syntax',
                severity: 'error',
            });
        });
    });

    describe('warn()', () => {
        it('records a warning diagnostic', () => {
            const diag = new DiagnosticCollector();
            diag.warn('file.dto', 5, 'unused field');
            const all = diag.getAll();
            expect(all).toHaveLength(1);
            expect(all[0]!.severity).toBe('warning');
        });
    });

    // ─── hasErrors() ────────────────────────────────────────────────

    describe('hasErrors()', () => {
        it('returns false when empty', () => {
            const diag = new DiagnosticCollector();
            expect(diag.hasErrors()).toBe(false);
        });

        it('returns false when only warnings exist', () => {
            const diag = new DiagnosticCollector();
            diag.warn('f', 1, 'w');
            expect(diag.hasErrors()).toBe(false);
        });

        it('returns true when errors exist', () => {
            const diag = new DiagnosticCollector();
            diag.error('f', 1, 'e');
            expect(diag.hasErrors()).toBe(true);
        });

        it('returns true when mixed errors and warnings', () => {
            const diag = new DiagnosticCollector();
            diag.warn('f', 1, 'w');
            diag.error('f', 2, 'e');
            expect(diag.hasErrors()).toBe(true);
        });
    });

    // ─── getAll() ───────────────────────────────────────────────────

    describe('getAll()', () => {
        it('returns a copy of diagnostics', () => {
            const diag = new DiagnosticCollector();
            diag.error('f', 1, 'e');
            const all = diag.getAll();
            all.pop();
            expect(diag.getAll()).toHaveLength(1);
        });

        it('preserves insertion order', () => {
            const diag = new DiagnosticCollector();
            diag.error('f', 1, 'first');
            diag.warn('f', 2, 'second');
            diag.error('f', 3, 'third');
            const all = diag.getAll();
            expect(all.map(d => d.message)).toEqual(['first', 'second', 'third']);
        });
    });

    // ─── report() ──────────────────────────────────────────────────

    describe('report()', () => {
        it('writes errors and warnings to stderr', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const diag = new DiagnosticCollector();
            diag.error('file.dto', 3, 'bad');
            diag.warn('file.dto', 5, 'hmm');
            diag.report();

            expect(spy).toHaveBeenCalled();
            const calls = spy.mock.calls.map(c => c[0] as string);
            expect(calls.some(c => c.includes('ERROR') && c.includes('bad'))).toBe(true);
            expect(calls.some(c => c.includes('WARN') && c.includes('hmm'))).toBe(true);
            expect(calls.some(c => c.includes('1 error(s)'))).toBe(true);

            spy.mockRestore();
        });

        it('does nothing when no diagnostics', () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const diag = new DiagnosticCollector();
            diag.report();
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        });
    });
});
