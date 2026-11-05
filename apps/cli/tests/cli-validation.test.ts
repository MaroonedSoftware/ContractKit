import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Runs the built binary rather than importing `cli.ts`, which starts `main()` on import. The CLI keeps
 * its own list of cross-file validators apart from `validateProject`, so a validator missing from that
 * list passes every core test and only shows up here.
 */
const CLI = resolve(import.meta.dirname, '../dist/cli.js');

describe('contractkit cross-file validation', () => {
    let dir: string;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'ck-cli-validation-'));
        writeFileSync(join(dir, 'contractkit.config.json'), JSON.stringify({ patterns: ['*.ck'], plugins: {} }));
    });

    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    function build(source: string) {
        writeFileSync(join(dir, 'api.ck'), source);
        return spawnSync(process.execPath, [CLI], { cwd: dir, encoding: 'utf-8' });
    }

    it('fails the build on a decimal in an undiscriminated union', () => {
        const { status, stdout, stderr } = build('contract M: {\n    amount: decimal | string\n}\n');
        expect(stdout + stderr).toMatch(/'M\.amount' puts a decimal inside an undiscriminated union/);
        expect(status).toBe(1);
    });

    it('fails the build on a decimal response header', () => {
        const source = `operation /prices: {
    get: {
        response: {
            200: {
                headers: {
                    x-total: decimal
                }
            }
        }
    }
}
`;
        const { status, stdout, stderr } = build(source);
        expect(stdout + stderr).toMatch(/Response header 'x-total' is declared as a decimal/);
        expect(status).toBe(1);
    });

    it('accepts a nullable decimal', () => {
        const { status, stdout, stderr } = build('contract M: {\n    amount: decimal | null\n}\n');
        expect(stdout + stderr).not.toMatch(/decimal/);
        expect(status).toBe(0);
    });
});
