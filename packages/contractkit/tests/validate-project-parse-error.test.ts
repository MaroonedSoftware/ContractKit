import { afterEach, describe, expect, it, vi } from 'vitest';

// Isolated file: mocks `parseCk` to throw so we can exercise validateProject's
// internal-parse-error catch path without contaminating the module cache used by
// the other validate-project tests.

afterEach(() => {
    vi.doUnmock('../src/parser.js');
    vi.resetModules();
});

describe('validateProject — internal parse error', () => {
    it('emits a diagnostic (instead of silently dropping the file) when parseCk throws', async () => {
        vi.resetModules();
        vi.doMock('../src/parser.js', () => ({
            parseCk: () => {
                throw new Error('boom');
            },
        }));

        const { validateProject } = await import('../src/validate-project.js');
        const result = validateProject({ files: [{ filePath: 'bad.ck', source: 'contract X: { a: string }' }] });

        const errs = result.diag.getAll().filter(d => d.severity === 'error');
        expect(errs.some(e => e.file === 'bad.ck' && e.message.includes('Internal parse error') && e.message.includes('boom'))).toBe(true);
    });
});
