import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOnce } from './harness.js';

/**
 * Whether the generated Python SDK is loadable and its methods can actually run.
 *
 * `ast.parse` alone is not enough. The defect that shipped leaves every file syntactically valid:
 * the method signature is snake_cased while the f-string still interpolates the raw contract name,
 * so the module imports fine and the call raises `NameError`. `check_python.py` walks the
 * f-strings for exactly that.
 *
 * Snapshotted rather than asserted empty, for the reason given in `typecheck.test.ts`.
 */

const testsDir = dirname(fileURLToPath(import.meta.url));

const hasPython3 = spawnSync('python3', ['--version']).status === 0;

const { files } = await buildOnce();

interface Report {
    syntax: { file: string; message: string }[];
    unbound: { file: string; function: string; name: string }[];
    literal: { file: string; function: string; url: string }[];
}

function runChecker(): Report {
    const sources = Object.fromEntries([...files.python].filter(([path]) => path.endsWith('.py')));
    const result = spawnSync('python3', [resolve(testsDir, 'scripts', 'check_python.py')], {
        input: JSON.stringify(sources),
        encoding: 'utf-8',
    });
    if (result.status !== 0) throw new Error(`check_python.py failed: ${result.stderr}`);
    return JSON.parse(result.stdout) as Report;
}

describe.skipIf(!hasPython3)('generated Python', () => {
    it('records syntax, unbound-name and un-interpolated-URL findings as a baseline', async () => {
        const { syntax, unbound, literal } = runChecker();

        const lines = [
            ...syntax.map(s => `syntax ${s.file}: ${s.message}`),
            ...unbound.map(u => `unbound ${u.file}: ${u.function}() interpolates '${u.name}', which nothing binds`),
            ...literal.map(l => `literal ${l.file}: ${l.function}() requests '${l.url}' with the placeholder unsubstituted`),
        ].sort();

        await expect(lines.length === 0 ? '(no findings)\n' : lines.join('\n') + '\n').toMatchFileSnapshot('./__snapshots__/_python.txt');
    });
});
