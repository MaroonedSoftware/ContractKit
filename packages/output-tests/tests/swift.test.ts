import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { buildOnce } from './harness.js';

/**
 * Whether the generated Swift SDK actually compiles.
 *
 * Snapshots catch a change in what is emitted; they cannot tell a valid file from one the compiler
 * rejects. The Kotlin plugin went unbuilt until after release, and its first real compile turned up
 * two bugs its string assertions could not see. The build runs in Swift 6 language mode with
 * complete concurrency checking, the strictest settings a consumer can turn on against the
 * module's public API, and with warnings as errors, because every generated type is meant to be
 * `Sendable` without an escape hatch.
 */

const swift = spawnSync('swift', ['--version'], { encoding: 'utf-8' });
const hasSwift = swift.status === 0;

const { files } = await buildOnce();

/** The flags every toolchain check in the repository builds with. */
const STRICT_FLAGS = ['-Xswiftc', '-warnings-as-errors', '-Xswiftc', '-swift-version', '-Xswiftc', '6', '-Xswiftc', '-strict-concurrency=complete'];

/** Write the emitted Swift tree to a temp directory and build it. Returns the compiler's diagnostics. */
function build(): { status: number | null; diagnostics: string[]; output: string } {
    const root = mkdtempSync(join(tmpdir(), 'ck-swift-'));
    let packageDir: string | undefined;

    for (const [path, content] of files.swift) {
        // Paths are rootDir-relative POSIX, e.g. `swiftsdk/Sources/ExampleSdk/Models/BillingModels.swift`.
        const abs = resolve(root, path);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content, 'utf-8');
        if (path.endsWith('/Package.swift')) packageDir = dirname(abs);
    }

    if (!packageDir) throw new Error('The Swift plugin emitted no Package.swift; scaffold must be on for this suite.');

    const result = spawnSync('swift', ['build', '--package-path', packageDir, ...STRICT_FLAGS], { encoding: 'utf-8' });

    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    // The driver prints a diagnostic once per compile job, so the same line can appear twice.
    const diagnostics = [...new Set(output.split('\n'))]
        .filter(line => /: (error|warning): /.test(line))
        .map(line => line.trim())
        .sort();

    return { status: result.status, diagnostics, output };
}

/**
 * A cold build compiles the manifest and the module from nothing; the suite-wide 50s timeout is not
 * enough on a slow CI runner.
 */
const BUILD_TIMEOUT_MS = 300_000;

describe.skipIf(!hasSwift)('generated Swift', () => {
    it(
        'compiles in Swift 6 mode with no errors and no warnings',
        () => {
            const { status, diagnostics, output } = build();
            expect(diagnostics).toEqual([]);
            expect(status, output).toBe(0);
        },
        BUILD_TIMEOUT_MS,
    );
});
