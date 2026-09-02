import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
    type ContractKitPlugin,
    type ContractRootNode,
    type Diagnostic,
    type OpRootNode,
    type PluginContext,
} from '@contractkit/core';
import { createTypescriptPlugin } from '@contractkit/plugin-typescript';
import { createPythonSdkPlugin } from '@contractkit/plugin-python';
import { createOpenApiPlugin } from '@contractkit/plugin-openapi';
import { createMarkdownPlugin } from '@contractkit/plugin-markdown';
import { createBrunoPlugin } from '@contractkit/plugin-bruno';
import { createDocsPlugin } from '@contractkit/plugin-docs';

/**
 * Every plugin is run against a fixed set of fixtures and every emitted file is
 * snapshotted, so a change to any generator shows up as a reviewable diff rather than as a
 * `toContain` assertion that happens to still pass. The per-plugin `_files.txt` listing is what
 * makes a *lost* or *added* file visible; the content snapshots cover everything else.
 */

const testsDir = dirname(fileURLToPath(import.meta.url));

/** Fixture root the generated paths are relative to. Never written to — the harness captures emits in memory. */
export const ROOT_DIR = '/project';

export const FIXTURES = ['billing.ck', 'hyphenated.ck', 'simple.ck'] as const;

/** Every file one plugin emitted, keyed by a rootDir-relative POSIX path. */
export type EmittedFiles = Map<string, string>;

export interface BuildResult {
    files: Record<PluginName, EmittedFiles>;
    diagnostics: Diagnostic[];
}

export type PluginName = 'typescript' | 'python' | 'openapi' | 'markdown' | 'bruno' | 'docs';

/**
 * Fake `PluginContext` capturing `emitFile` in memory, mirroring `makeCtx` in
 * plugin-typescript's `codegen-server.test.ts`. `cacheEnabled` is false so no plugin honours a
 * prior manifest, but `cacheDir` still points at a real temp directory: the TypeScript, Python
 * and Bruno plugins call `writeManifest` unconditionally at the end of a run.
 */
function makeCtx(cacheDir: string): PluginContext & { emitted: EmittedFiles } {
    const emitted: EmittedFiles = new Map();
    return {
        rootDir: ROOT_DIR,
        options: {},
        cacheEnabled: false,
        cacheDir,
        emitFile: (outPath: string, content: string) => {
            emitted.set(toRelPosix(outPath), content);
        },
        emitted,
    };
}

/** Normalise an absolute emitted path to a stable, platform-independent snapshot key. */
function toRelPosix(outPath: string): string {
    return relative(ROOT_DIR, outPath).split(sep).join('/');
}

/**
 * Parse the fixtures through the same pass order the CLI uses — `parseCk`, then the two
 * normalization passes, then `decomposeCk` — so the plugins see exactly the AST they see in a
 * real build. Doing it any other way would make the snapshots describe a pipeline nobody runs.
 */
function parseFixtures(diag: DiagnosticCollector): { contractRoots: ContractRootNode[]; opRoots: OpRootNode[] } {
    const contractRoots: ContractRootNode[] = [];
    const opRoots: OpRootNode[] = [];

    for (const name of FIXTURES) {
        const filePath = join(ROOT_DIR, 'contracts', name);
        const source = readFileSync(resolve(testsDir, 'fixtures', name), 'utf-8');

        const ckAst = parseCk(source, filePath, diag);
        applyOptionsDefaults(ckAst, diag);
        applyVariableSubstitution(ckAst, diag);

        const { contract, op } = decomposeCk(ckAst);
        if (contract.models.length > 0) contractRoots.push(contract);
        if (op.routes.length > 0) opRoots.push(op);
    }

    return { contractRoots, opRoots };
}

/** The five plugins, configured to turn every sub-generator this batch touches on. */
function makePlugins(): { name: PluginName; plugin: ContractKitPlugin }[] {
    return [
        {
            name: 'typescript',
            plugin: createTypescriptPlugin(
                {
                    server: {
                        baseDir: 'server',
                        zod: true,
                        output: { routes: 'routes/{filename}.router.ts', types: 'schemas/{filename}.schema.ts' },
                    },
                    sdk: {
                        baseDir: 'sdk',
                        zod: true,
                        scaffold: true,
                        output: { sdk: 'index.ts', clients: 'clients/{filename}.client.ts', types: 'types/{filename}.types.ts' },
                    },
                    mcp: { baseDir: 'server' },
                },
                ROOT_DIR,
            ),
        },
        { name: 'python', plugin: createPythonSdkPlugin({ baseDir: 'pysdk' }, ROOT_DIR) },
        { name: 'openapi', plugin: createOpenApiPlugin({ output: 'openapi.yaml', info: { title: 'Kitchen Sink', version: '1.0.0' } }, ROOT_DIR) },
        { name: 'markdown', plugin: createMarkdownPlugin({ output: 'api-reference.md' }, ROOT_DIR) },
        { name: 'bruno', plugin: createBrunoPlugin({ output: 'bruno', randomExamples: false }, ROOT_DIR) },
        {
            name: 'docs',
            plugin: createDocsPlugin({ mintlify: { baseDir: 'docs', openapi: { info: { title: 'Kitchen Sink', version: '1.0.0' } } } }, ROOT_DIR),
        },
    ];
}

/**
 * Run every plugin over the fixtures and return what each one emitted, plus every diagnostic the
 * build produced. Cached per module so the snapshot tests share one run.
 */
export async function buildFixtures(): Promise<BuildResult> {
    const diag = new DiagnosticCollector();
    const { contractRoots, opRoots } = parseFixtures(diag);

    // The cross-file validation the CLI runs before handing anything to a plugin, in the same
    // order. Without it the diagnostics snapshot would record only parse and normalization
    // warnings, and every build-time check would be invisible here.
    validateRefs(contractRoots, opRoots, diag);
    validateInheritance(contractRoots, diag);
    for (const root of opRoots) validateOp(root, diag);

    const models = contractRoots.flatMap(r => r.models);
    const inputs = {
        contractRoots,
        opRoots,
        modelsWithInput: computeModelsWithInput(models),
        modelsWithOutput: computeModelsWithOutput(models),
    };

    const cacheDir = mkdtempSync(join(tmpdir(), 'ck-output-tests-'));
    const files = {} as Record<PluginName, EmittedFiles>;

    for (const { name, plugin } of makePlugins()) {
        const ctx = makeCtx(cacheDir);
        await plugin.generateTargets!(inputs, ctx);
        files[name] = ctx.emitted;
    }

    return { files, diagnostics: diag.getAll() };
}

let cached: Promise<BuildResult> | undefined;

/** Shared single build — every test file reads the same emitted output. */
export function buildOnce(): Promise<BuildResult> {
    cached ??= buildFixtures();
    return cached;
}

/** Render a diagnostic list as stable snapshot text. */
export function formatDiagnostics(diagnostics: Diagnostic[]): string {
    if (diagnostics.length === 0) return '(no diagnostics)\n';
    return (
        diagnostics
            .map(d => `${d.severity} ${toRelPosix(d.file)}:${d.line} ${d.code ? `[${d.code}] ` : ''}${d.message}`)
            .sort()
            .join('\n') + '\n'
    );
}
