import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
 *
 * CI installs the SDK, so these run there. The `dotnet` gate below is for a contributor's machine
 * that has none, not an exemption: a change that only compiles locally still fails the build.
 */

const dotnet = spawnSync('dotnet', ['--version'], { encoding: 'utf-8' });
const hasDotnet = dotnet.status === 0;

/** A restore that could not reach a feed. Says nothing about the generated code, so the suite stands down. */
const OFFLINE = /NU1301|NU1101|NU1900|Unable to load the service index/;

const { files } = await buildOnce();

/** Write an emitted C# tree to a fresh temp directory. Returns that directory and the project in it. */
function materialise(tree: EmittedFiles): { root: string; project: string } {
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
    return { root, project };
}

/** Run the .NET CLI and split its output into the diagnostics the compiler reported. */
function dotnetRun(args: string[]): { status: number | null; diagnostics: string[]; output: string } {
    const result = spawnSync('dotnet', args, {
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

/** Build an emitted C# tree. Returns the compiler's diagnostics. */
function build(tree: EmittedFiles): { status: number | null; diagnostics: string[]; output: string } {
    const { project } = materialise(tree);
    return dotnetRun(['build', project, '-nologo', '-v', 'q', '-warnaserror']);
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

/**
 * Write a console project beside the SDK that references its netstandard2.0 leg and prints what the
 * SDK's own `JsonSerializerOptions` produce.
 *
 * `SetTargetFramework` is what pins the reference to the old leg: without it a net10.0 host picks the
 * net10.0 one, and the polyfills this exists to exercise would never load. The values cover every
 * options-level converter — `date`, `time`, `decimal`, `bigint` and `duration` — since a model field
 * alone would not reach the three that are not date-shaped.
 */
function writeSmokeProject(root: string, sdkProject: string): void {
    const dir = join(root, 'smoke');
    mkdirSync(dir, { recursive: true });

    writeFileSync(
        join(dir, 'Smoke.csproj'),
        `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>disable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="${relative(dir, sdkProject).split(sep).join('/')}" SetTargetFramework="TargetFramework=netstandard2.0" />
  </ItemGroup>
</Project>
`,
        'utf-8',
    );

    writeFileSync(
        join(dir, 'Program.cs'),
        `using System;
using System.Globalization;
using System.Numerics;
using System.Text.Json;
using Example.Sdk.Models;
using Example.Sdk.Runtime;
// The host has a System.DateOnly of its own, so the SDK's is named outright. These aliases also fail
// to compile unless the reference really did resolve to the netstandard2.0 leg.
using SdkDate = Example.Sdk.Runtime.DateOnly;
using SdkTime = Example.Sdk.Runtime.TimeOnly;

internal static class Program
{
    private static void Main()
    {
        var seat = new Seat
        {
            Class = "economy",
            Date = new SdkDate(2026, 9, 20),
            From = new SdkDate(2026, 1, 2),
            Time = new SdkTime(9, 30),
        };

        var json = JsonSerializer.Serialize(seat, SdkJson.Options);
        var back = JsonSerializer.Deserialize<Seat>(json, SdkJson.Options)!;

        Report("date-type", typeof(SdkDate).FullName!);
        Report("seat", json);
        Report("seat-round-trips", (back.Date == seat.Date && back.From == seat.From && back.Time == seat.Time).ToString());
        Report("time-fraction", JsonSerializer.Serialize(new SdkTime(9, 30, 15, 250), SdkJson.Options));
        Report("decimal", JsonSerializer.Serialize(9.99m, SdkJson.Options));
        Report("bigint", JsonSerializer.Serialize(BigInteger.Parse("9007199254740993"), SdkJson.Options));
        Report("duration", JsonSerializer.Serialize(TimeSpan.FromMinutes(90), SdkJson.Options));
        Report("date-as-datetime", back.Date.ToDateTime().ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) + " " + back.Date.ToDateTime().Kind);
        Report("time-as-timespan", back.Time!.Value.ToTimeSpan().ToString());
    }

    private static void Report(string key, string value) => Console.WriteLine("ck:" + key + "=" + value);
}
`,
        'utf-8',
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

    /**
     * What the netstandard2.0 build puts on the wire.
     *
     * Compiling says the polyfilled `DateOnly` and `TimeOnly` are accepted; it does not say they
     * serialize to what the contract promised, and a wrong format here would reach a service rather
     * than a compiler. The host is net10.0 because that is what runs, and it binds the old leg of the
     * SDK on purpose: the `Example.Sdk.Runtime.DateOnly` aliases below exist on no other leg, so the
     * program would not compile if the reference resolved to net10.0.
     */
    it(
        'serializes the netstandard2.0 build to the wire forms the contract names',
        async ctx => {
            const { root, project } = materialise(await emit({ targetFrameworks: ['netstandard2.0', 'net10.0'] }));
            writeSmokeProject(root, project);

            const { status, output } = dotnetRun(['run', '--project', join(root, 'smoke', 'Smoke.csproj')]);
            if (status !== 0 && OFFLINE.test(output)) {
                ctx.skip(`no NuGet feed reachable, so the netstandard2.0 leg cannot restore:\n${output}`);
            }
            expect(status, output).toBe(0);

            const reported = new Map(
                output
                    .split('\n')
                    .filter(line => line.startsWith('ck:'))
                    .map(line => line.slice('ck:'.length).trim().split('=', 2) as [string, string]),
            );
            expect(Object.fromEntries(reported)).toEqual({
                'date-type': 'Example.Sdk.Runtime.DateOnly',
                seat: '{"class":"economy","from":"2026-01-02","date":"2026-09-20","time":"09:30:00"}',
                'seat-round-trips': 'True',
                // Seven digits, which is what System.Text.Json writes for a TimeOnly on net10.0.
                'time-fraction': '"09:30:15.2500000"',
                decimal: '"9.99"',
                bigint: '"9007199254740993"',
                duration: '"PT1H30M"',
                'date-as-datetime': '2026-09-20 00:00 Unspecified',
                'time-as-timespan': '09:30:00',
            });
        },
        BUILD_TIMEOUT_MS,
    );
});
