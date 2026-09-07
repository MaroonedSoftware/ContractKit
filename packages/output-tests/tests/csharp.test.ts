import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildOnce } from './harness.js';

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

const { files } = await buildOnce();

/** Write the emitted C# tree to a temp directory and build it. Returns the compiler's diagnostics. */
function build(): { status: number | null; diagnostics: string[]; output: string } {
    const root = mkdtempSync(join(tmpdir(), 'ck-csharp-'));
    let project: string | undefined;

    for (const [path, content] of files.csharp) {
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

describe.skipIf(!hasDotnet)('generated C#', () => {
    it(
        'compiles with no errors and no warnings',
        () => {
            const { status, diagnostics, output } = build();
            expect(diagnostics).toEqual([]);
            expect(status, output).toBe(0);
        },
        // A cold build resolves the targeting pack and runs the compiler; the suite-wide 50s
        // timeout is not enough for the first run on a clean machine.
        180_000,
    );
});
