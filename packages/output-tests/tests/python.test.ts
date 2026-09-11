import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOnce } from './harness.js';

/**
 * Whether the generated Python SDK is loadable and its methods can actually run.
 *
 * `ast.parse` alone is not enough. The defect that shipped leaves every file syntactically valid:
 * the method signature is snake_cased while the f-string still interpolates the raw contract name,
 * so the module imports fine and the call raises `NameError`. `check_python.py` walks the
 * f-strings for exactly that.
 */

const testsDir = dirname(fileURLToPath(import.meta.url));

const hasPython3 = spawnSync('python3', ['--version']).status === 0;

/**
 * An interpreter that can type-check and import the SDK: Python 3.11 or later (the SDK uses
 * `typing.NotRequired`) with mypy, pydantic and httpx installed. CI has none of them, so the checks
 * that need one are skipped there. Point `CK_TEST_PYTHON` at a virtualenv's `python` to run them.
 */
const sdkPython = process.env.CK_TEST_PYTHON ?? 'python3';
const canRunSdk = spawnSync(sdkPython, ['-c', 'import sys, mypy, pydantic, httpx; sys.exit(sys.version_info < (3, 11))']).status === 0;

const { files } = await buildOnce();

interface Report {
    syntax: { file: string; message: string }[];
    unbound: { file: string; function: string; name: string }[];
    literal: { file: string; function: string; url: string }[];
    shadowed: { file: string; class: string; field: string; name: string }[];
    importTime: { file: string; line: number; name: string }[];
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
    it('parses, binds every name it reads, and shadows no annotated type', () => {
        const { syntax, unbound, literal, shadowed, importTime } = runChecker();

        const lines = [
            ...syntax.map(s => `syntax ${s.file}: ${s.message}`),
            ...unbound.map(u => `unbound ${u.file}: ${u.function}() interpolates '${u.name}', which nothing binds`),
            ...literal.map(l => `literal ${l.file}: ${l.function}() requests '${l.url}' with the placeholder unsubstituted`),
            ...shadowed.map(s => `shadowed ${s.file}: ${s.class}.${s.field} annotates with '${s.name}', which the class body assigns`),
            ...importTime.map(i => `import-time ${i.file}:${i.line} reads '${i.name}', which the module never binds`),
        ].sort();

        expect(lines).toEqual([]);
    });
});

/** Write the emitted package to disk, so it can be imported and type-checked as a real package. */
function materialiseSdk(): string {
    const dir = mkdtempSync(join(tmpdir(), 'ck-python-'));
    for (const [relPath, content] of files.python) {
        if (!relPath.endsWith('.py')) continue;
        mkdirSync(dirname(join(dir, relPath)), { recursive: true });
        writeFileSync(join(dir, relPath), content, 'utf-8');
    }
    return dir;
}

describe.skipIf(!canRunSdk)('generated Python, with Pydantic installed', () => {
    const dir = canRunSdk ? materialiseSdk() : '';

    it('passes mypy --strict', () => {
        // A caller's own mypy run checks every call against these signatures, so an error here
        // is one in every project that type-checks its use of the SDK.
        const result = spawnSync(
            sdkPython,
            ['-m', 'mypy', '--strict', '--no-error-summary', '--cache-dir', join(dir, '.mypy_cache'), '-p', 'pysdk'],
            {
                cwd: dir,
                encoding: 'utf-8',
            },
        );
        const errors = result.stdout.split('\n').filter(line => line.includes(': error:'));
        expect(errors).toEqual([]);
        expect(result.status).toBe(0);
    });

    it('imports every module with warnings as errors', () => {
        // What the static checks can only approximate: Pydantic building every model, resolving
        // every annotation, and warning about any field that shadows a BaseModel attribute.
        const script =
            'import importlib, pkgutil, pysdk\nfor m in pkgutil.iter_modules(pysdk.__path__):\n    importlib.import_module("pysdk." + m.name)';
        const result = spawnSync(sdkPython, ['-W', 'error', '-c', script], { cwd: dir, encoding: 'utf-8' });
        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
    });
});
