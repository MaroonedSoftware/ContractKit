import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    DiagnosticCollector,
    applyOptionsDefaults,
    applyVariableSubstitution,
    computeModelsWithInput,
    computeModelsWithOutput,
    decomposeCk,
    parseCk,
    validateInheritance,
    validateOp,
    validateRefs,
    type PluginContext,
} from '@contractkit/core';
import { createSwiftSdkPlugin } from '../src/index.js';

/**
 * Builds the SDK generated from `fixtures/stress.ck` with a real Swift toolchain, then runs
 * `fixtures/probe.swift` against it.
 *
 * `packages/output-tests` compiles the shared fixtures, but those hold no union, no recursion, no
 * tuple, no `format()` contract and no multi-status response, so the generator's hardest branches
 * never reach a compiler there. And a compile cannot see a decode bug at all: the Kotlin plugin
 * shipped a struct that compiled and then failed on the first real response. The probe decodes,
 * encodes and round-trips through the generated types, and drives the generated client over a
 * mock transport.
 *
 * Skipped when `swift` is not on the PATH. GitHub's `ubuntu-latest` image ships it, so CI runs it.
 */

const testsDir = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(testsDir, 'fixtures');
const ROOT_DIR = '/project';
const MODULE = 'StressSdk';

const hasSwift = spawnSync('swift', ['--version'], { encoding: 'utf-8' }).status === 0;

/** Same flags as `packages/output-tests/tests/swift.test.ts`: the strictest a consumer can pick. */
const STRICT_FLAGS = ['-Xswiftc', '-warnings-as-errors', '-Xswiftc', '-swift-version', '-Xswiftc', '6', '-Xswiftc', '-strict-concurrency=complete'];

interface Generated {
    files: Map<string, string>;
    warnings: string[];
    diagnostics: string[];
}

/** Parse `stress.ck` through the CLI's pass order and run the plugin on it, capturing output in memory. */
async function generate(): Promise<Generated> {
    const diag = new DiagnosticCollector();
    const filePath = join(ROOT_DIR, 'contracts', 'stress.ck');
    const ast = parseCk(readFileSync(join(fixturesDir, 'stress.ck'), 'utf-8'), filePath, diag);
    applyOptionsDefaults(ast, diag);
    applyVariableSubstitution(ast, diag);
    const { contract, op } = decomposeCk(ast);

    validateRefs([contract], [op], diag);
    validateInheritance([contract], diag);
    validateOp(op, diag);

    const files = new Map<string, string>();
    const warnings: string[] = [];
    const ctx: PluginContext = {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir: mkdtempSync(join(tmpdir(), 'ck-swift-cache-')),
        emitFile: (outPath: string, content: string) => {
            files.set(relative(ROOT_DIR, outPath).split(sep).join('/'), content);
        },
        warn: (message: string) => {
            warnings.push(message);
        },
    };

    const plugin = createSwiftSdkPlugin({ baseDir: 'sdk', moduleName: MODULE, sdkName: 'Stress', scaffold: true, includeInternal: true }, ROOT_DIR);
    await plugin.generateTargets!(
        {
            contractRoots: [contract],
            opRoots: [op],
            modelsWithInput: computeModelsWithInput(contract.models),
            modelsWithOutput: computeModelsWithOutput(contract.models),
        },
        ctx,
    );

    const diagnostics = diag.getAll().map(d => `${d.severity} ${d.line}: ${d.message}`);
    return { files, warnings, diagnostics };
}

/**
 * Write the package to disk with the probe added as an executable target. `Package.swift` is the
 * user-owned scaffold, so editing it is what a real consumer would do; the edit keeps the
 * scaffold's platforms and library target, so the manifest the plugin writes is what gets built.
 */
function writePackage(files: Map<string, string>): string {
    const root = mkdtempSync(join(tmpdir(), 'ck-swift-toolchain-'));
    for (const [path, content] of files) {
        const abs = resolve(root, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf-8');
    }

    const packageDir = join(root, 'sdk');
    const manifestPath = join(packageDir, 'Package.swift');
    const library = `.target(name: "${MODULE}"),`;
    const manifest = readFileSync(manifestPath, 'utf-8');
    if (!manifest.includes(library)) throw new Error(`The scaffolded Package.swift no longer declares ${library}; update writePackage.`);
    writeFileSync(
        manifestPath,
        manifest.replace(library, `${library}\n        .executableTarget(name: "Probe", dependencies: ["${MODULE}"]),`),
        'utf-8',
    );

    mkdirSync(join(packageDir, 'Sources', 'Probe'), { recursive: true });
    copyFileSync(join(fixturesDir, 'probe.swift'), join(packageDir, 'Sources', 'Probe', 'Probe.swift'));
    return packageDir;
}

function run(args: string[]): { status: number | null; output: string } {
    const result = spawnSync('swift', args, { encoding: 'utf-8' });
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

let generated: Generated;

beforeAll(async () => {
    generated = await generate();
});

describe('stress.ck', () => {
    it('parses and validates cleanly', () => {
        expect(generated.diagnostics).toEqual([]);
    });

    it('warns only about the anonymous object inside the format() contract', () => {
        // The fixture keeps this construct on purpose, so the warning path stays covered.
        expect(generated.warnings).toHaveLength(1);
        expect(generated.warnings[0]).toMatch(/Contract 'Token' is declared format\(output=snake\) and holds an anonymous object/);
    });
});

describe.skipIf(!hasSwift)('stress.ck with the Swift toolchain', () => {
    let packageDir: string;
    let build: { status: number | null; output: string };

    beforeAll(() => {
        packageDir = writePackage(generated.files);
        build = run(['build', '--package-path', packageDir, ...STRICT_FLAGS]);
    }, 300_000);

    it('compiles in Swift 6 mode with no errors and no warnings', () => {
        // The driver prints a diagnostic once per compile job, so the same line can appear twice.
        const diagnostics = [...new Set(build.output.split('\n'))].filter(line => /: (error|warning): /.test(line)).map(line => line.trim());
        expect(diagnostics).toEqual([]);
        expect(build.status, build.output).toBe(0);
    });

    it('passes every probe check at runtime', () => {
        expect(build.status, 'the build failed; see the compile test').toBe(0);
        const probe = run(['run', '--package-path', packageDir, '--skip-build', 'Probe']);
        const failures = probe.output.split('\n').filter(line => line.startsWith('FAIL'));
        expect(failures).toEqual([]);
        expect(probe.status, probe.output).toBe(0);
        expect(probe.output).toContain('ALL PASS');
    }, 60_000);
});
