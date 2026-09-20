import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createCSharpSdkPlugin } from '@contractkit/plugin-csharp';
import { buildOnce, buildWithPlugin, ROOT_DIR, type EmittedFiles } from './harness.js';

/**
 * Whether the generated C# SDK actually compiles.
 *
 * Snapshots catch a change in what is emitted; they cannot tell a valid file from one the compiler
 * rejects. The Kotlin plugin has no equivalent check, and three of its first four released fixes
 * were compile errors a real toolchain would have caught. `-warnaserror` is deliberate: the
 * generator's own invariant is that every property is `required` or initialized, so a nullable
 * warning means the generator has a gap.
 */

const dotnet = spawnSync('dotnet', ['--version'], { encoding: 'utf-8' });
const hasDotnet = dotnet.status === 0;

/** A restore that could not reach a feed. Says nothing about the generated code, so the suite stands down. */
const OFFLINE = /NU1301|NU1101|NU1900|Unable to load the service index/;

const { files } = await buildOnce();

/** Write an emitted C# tree to a temp directory and build it. Returns the compiler's diagnostics. */
function build(tree: EmittedFiles): { status: number | null; diagnostics: string[]; output: string } {
    const root = mkdtempSync(join(tmpdir(), 'ck-csharp-'));
    let project: string | undefined;

    for (const [path, content] of tree) {
        // Paths are rootDir-relative POSIX, e.g. `cssdk/Models/Billing.cs`.
        const abs = resolve(root, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf-8');
        if (path.endsWith('.csproj')) project = abs;
    }

    if (!project) throw new Error('The C# plugin emitted no .csproj; scaffold must be on for this suite.');

    const result = spawnSync('dotnet', ['build', project, '-nologo', '-v', 'q', '-warnaserror'], {
        encoding: 'utf-8',
        env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_NOLOGO: '1',
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
            MSBUILDTERMINALLOGGER: 'off',
        },
    });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    const diagnostics = output
        .split('\n')
        .filter(line => / (error|warning) [A-Z]+\d+:/.test(line))
        .map(line => line.trim())
        .sort();

    return { status: result.status, diagnostics, output };
}

/**
 * A cold build resolves the targeting pack and runs the compiler, and the netstandard2.0 leg also
 * restores a package. The suite-wide 50s timeout is not enough for the first run on a clean machine.
 */
const BUILD_TIMEOUT_MS = 180_000;

/** The fixtures through the C# plugin again, with a configuration the snapshot tree does not carry. */
function emit(config: Partial<Parameters<typeof createCSharpSdkPlugin>[0]>): Promise<EmittedFiles> {
    return buildWithPlugin(
        createCSharpSdkPlugin({ baseDir: 'cssdk', namespace: 'Example.Sdk', sdkName: 'KitchenSink', scaffold: true, ...config }, ROOT_DIR),
    );
}

describe.skipIf(!hasDotnet)('generated C#', () => {
    it(
        'compiles with no errors and no warnings',
        () => {
            const { status, diagnostics, output } = build(files.csharp);
            expect(diagnostics).toEqual([]);
            expect(status, output).toBe(0);
        },
        BUILD_TIMEOUT_MS,
    );

    /**
     * The same sources against the framework a UWP project can reference.
     *
     * Everything the netstandard2.0 leg needs is either a polyfill the plugin emits or a `#if` in the
     * runtime, and none of it is compiled on net10.0 — so nothing but a real build of that leg can
     * tell whether it holds. Unlike the default configuration this one restores `System.Text.Json`
     * from a feed, which is why it stands down when there is no feed to reach.
     */
    it(
        'compiles for netstandard2.0 alongside net10.0',
        async ctx => {
            const tree = await emit({ targetFrameworks: ['netstandard2.0', 'net10.0'] });
            expect(tree.has('cssdk/Runtime/Polyfills.cs')).toBe(true);

            const { status, diagnostics, output } = build(tree);
            if (status !== 0 && OFFLINE.test(output)) {
                ctx.skip(`no NuGet feed reachable, so the netstandard2.0 leg cannot restore:\n${output}`);
            }

            expect(diagnostics).toEqual([]);
            expect(status, output).toBe(0);
        },
        BUILD_TIMEOUT_MS,
    );

    /**
     * `dateTypes: "datetime"` moves every `date` in the fixtures, in a model, a query record and a
     * response header alike, and adds an options-level converter for a type nothing else uses. Only a
     * compile says whether those still agree with each other.
     */
    it(
        'compiles with a date mapped to DateTime',
        async () => {
            const tree = await emit({ dateTypes: 'datetime' });
            const { status, diagnostics, output } = build(tree);
            expect(diagnostics).toEqual([]);
            expect(status, output).toBe(0);
        },
        BUILD_TIMEOUT_MS,
    );
});
