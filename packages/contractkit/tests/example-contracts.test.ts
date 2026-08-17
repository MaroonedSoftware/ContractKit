import { describe, expect, it } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateProject } from '../src/validate-project.js';

/**
 * The contracts under `contracts/` are what the documentation shows and what a reader copies
 * first, and `packages/docs-images` renders its figures straight out of these files. So they are
 * held to the same bar as user code: the whole directory is validated as one project, and neither
 * an error nor a warning is tolerated.
 *
 * Cross-file validation is the reason this runs `validateProject` over the entire set rather than
 * parsing each file alone — `contracts/examples/commerce` deliberately splits models and routes
 * across files, which only proves anything if unresolved references would fail here.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('example contracts', () => {
    const files = globSync('contracts/**/*.ck', { cwd: root }).sort();

    it('finds the checked-in example contracts', () => {
        expect(files.length).toBeGreaterThanOrEqual(5);
    });

    it('compiles the whole contracts/ directory as one project, clean', () => {
        const { diag } = validateProject({
            files: files.map(filePath => ({ filePath, source: readFileSync(`${root}${filePath}`, 'utf8') })),
        });

        const problems = diag.getAll().map(d => `${d.severity} ${d.file}:${d.line} ${d.message.split('\n').filter(Boolean).pop()?.trim()}`);
        expect(problems).toEqual([]);
    });
});
