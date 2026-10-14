import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DECIMAL_PATTERN } from '@contractkit/core';
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

    it('reads a decimal exactly when the published OpenAPI pattern accepts it, and writes plain digits', () => {
        // A bare pydantic `Decimal` read "1e5" and "NaN", and wrote 0.00000001 as "1E-8", which the
        // server rejects. `"5\n"` is here because Python's `$` also matches before a final newline.
        const inputs = ['1250.50', '1.10', '-5', '0', '1e5', '0x1F', '.5', '5.', '+5', '1_000', 'NaN', 'Infinity', '-Infinity', ' 5', '5\n', '١٢', ''];
        const script = [
            'import json, sys',
            'from decimal import Decimal',
            'from pydantic import TypeAdapter',
            'from pysdk._scalars import ExactDecimal',
            'from pysdk._base_client import _path_text, _wire_values',
            'adapter = TypeAdapter(ExactDecimal)',
            'def reads(text):',
            '    try:',
            '        adapter.validate_json(json.dumps(text))',
            '        return True',
            '    except Exception:',
            '        return False',
            'print(json.dumps({',
            '    "reads": {text: reads(text) for text in json.load(sys.stdin)},',
            '    "number": reads(5.5),',
            '    "written": adapter.dump_json(Decimal("0.00000001")).decode(),',
            '    "query": _wire_values({"a": Decimal("1E-8"), "b": [Decimal("1E+2")]}),',
            '    "path": _path_text(Decimal("1E-8")),',
            '}))',
        ].join('\n');
        const result = spawnSync(sdkPython, ['-c', script], { cwd: dir, encoding: 'utf-8', input: JSON.stringify(inputs) });
        expect(result.stderr).toBe('');
        const report = JSON.parse(result.stdout) as { reads: Record<string, boolean>; number: boolean; written: string; query: unknown; path: string };
        const pattern = new RegExp(DECIMAL_PATTERN);
        expect(report.reads).toEqual(Object.fromEntries(inputs.map(text => [text, pattern.test(text)])));
        expect(report.number).toBe(false);
        expect(report.written).toBe('"0.00000001"');
        expect(report.query).toEqual({ a: '0.00000001', b: ['100'] });
        expect(report.path).toBe('0.00000001');
    });

    it('reads an enum value it does not know as UNKNOWN, and refuses to send UNKNOWN', () => {
        // A Literal failed the whole response on a member the service added later. Known values
        // still read as their strings, a string beside an enum in a union still goes to the
        // string, and a value that is not a string is still rejected.
        const script = [
            'import asyncio, json',
            'import httpx',
            'from pydantic import TypeAdapter, ValidationError',
            'from pydantic_core import PydanticSerializationError',
            'from pysdk import UNKNOWN',
            'from pysdk._models_kitchen import Tally',
            'from pysdk._client_kitchen import KitchenClient',
            'from pysdk._base_client import _path_text, _wire_values',
            'def show(value):',
            '    if isinstance(value, list):',
            '        return [show(item) for item in value]',
            '    return "UNKNOWN" if value is UNKNOWN else value',
            'def refused(call):',
            '    try:',
            '        call()',
            '        return False',
            '    except PydanticSerializationError:',
            '        return True',
            'def rejected(data):',
            '    try:',
            '        Tally.model_validate(data)',
            '        return False',
            '    except ValidationError:',
            '        return True',
            'base = {"rating": "good", "maybe": None, "many": [], "either": "open", "fallback": 1}',
            'novel = Tally.model_validate({"rating": "great", "status": "archived", "maybe": "meh", "many": ["bad", "awful"], "either": "pending", "fallback": "pending"})',
            'known = Tally.model_validate({"rating": "good", "status": "open", "maybe": "neutral", "many": ["bad"], "either": "closed", "fallback": 7})',
            'seen = []',
            'def handler(request):',
            '    seen.append(str(request.url))',
            '    return httpx.Response(200, json=[{"rating": "new", "maybe": None, "many": [], "either": "x", "fallback": "y"}])',
            'async def calls():',
            '    client = KitchenClient("http://test")',
            '    client._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))',
            '    listed = await client.list_tallies({"rating": "bad"})',
            '    try:',
            '        await client.list_tallies({"rating": UNKNOWN})',
            '        sent = True',
            '    except PydanticSerializationError:',
            '        sent = False',
            '    return show(listed[0].rating), sent',
            'listed, sent_unknown = asyncio.run(calls())',
            'print(json.dumps({',
            '    "novel": {key: show(value) for key, value in novel},',
            '    "known": json.loads(known.model_dump_json(by_alias=True)),',
            '    "revalidated": show(Tally.model_validate(novel.model_dump()).rating),',
            '    "write_body": refused(lambda: novel.model_dump_json()),',
            '    "write_list": refused(lambda: TypeAdapter(list[Tally]).dump_json([novel])),',
            '    "write_query": refused(lambda: _wire_values({"rating": UNKNOWN})),',
            '    "write_query_list": refused(lambda: _wire_values({"many": ["good", UNKNOWN]})),',
            '    "write_path": refused(lambda: _path_text(UNKNOWN)),',
            '    "non_string": [rejected({**base, "rating": 5}), rejected({**base, "many": [None]}), rejected({**base, "fallback": 1.5})],',
            '    "listed": listed,',
            '    "sent_unknown": sent_unknown,',
            '    "requests": seen,',
            '}))',
        ].join('\n');
        const result = spawnSync(sdkPython, ['-W', 'error', '-c', script], { cwd: dir, encoding: 'utf-8' });
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout)).toEqual({
            novel: { rating: 'UNKNOWN', status: 'UNKNOWN', maybe: 'UNKNOWN', many: ['bad', 'UNKNOWN'], either: 'pending', fallback: 'UNKNOWN' },
            known: { rating: 'good', status: 'open', maybe: 'neutral', many: ['bad'], either: 'closed', fallback: 7 },
            revalidated: 'UNKNOWN',
            write_body: true,
            write_list: true,
            write_query: true,
            write_query_list: true,
            write_path: true,
            non_string: [true, true, true],
            listed: 'UNKNOWN',
            sent_unknown: false,
            requests: ['http://test/tallies?rating=bad'],
        });
    });
});
