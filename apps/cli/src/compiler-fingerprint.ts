import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { computeHash } from './cache.js';
import type { LoadedPlugin } from './plugin.js';

/**
 * Walk up from `startPath` looking for the nearest `package.json` and return
 * its `version`, or `''` if none is found within 10 levels, the file can't be
 * parsed, or the field is missing. Best-effort — never throws.
 */
export function readNearestPackageVersion(startPath: string): string {
    try {
        let dir = dirname(startPath);
        for (let i = 0; i < 10; i++) {
            const candidate = join(dir, 'package.json');
            if (existsSync(candidate)) {
                const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as { version?: string };
                return pkg.version ?? '';
            }
            const parent = dirname(dir);
            if (parent === dir) return '';
            dir = parent;
        }
    } catch {
        // best-effort
    }
    return '';
}

/**
 * Stable fingerprint of the codegen-affecting versions in play this run:
 * `@contractkit/cli`, `@contractkit/core`, and every loaded plugin keyed by
 * `name@version`. Used to invalidate the build cache when any of those
 * packages is upgraded — otherwise stale generated TypeScript would persist
 * until the next `--force` run.
 *
 * `cliEntryPath` should be the absolute path of the CLI entry module (the
 * caller passes `fileURLToPath(import.meta.url)`); it's parameterized so the
 * fingerprint is unit-testable without `import.meta` plumbing.
 */
export function computeCompilerFingerprint(plugins: LoadedPlugin[], cliEntryPath: string): string {
    const cliVersion = readNearestPackageVersion(cliEntryPath);
    let coreVersion = '';
    try {
        const corePkg = createRequire(cliEntryPath).resolve('@contractkit/core/package.json');
        coreVersion = (JSON.parse(readFileSync(corePkg, 'utf-8')) as { version?: string }).version ?? '';
    } catch {
        // Optional — fingerprint just omits core when it can't be resolved.
    }
    const pluginParts = plugins.map(p => `${p.plugin.name}@${p.version}`).sort();
    return computeHash(['cli', cliVersion, 'core', coreVersion, ...pluginParts].join('|'));
}

/** Convenience wrapper that derives the CLI entry path from the CLI's own `import.meta.url`. */
export function computeCompilerFingerprintFromImportMeta(plugins: LoadedPlugin[], importMetaUrl: string): string {
    return computeCompilerFingerprint(plugins, fileURLToPath(importMetaUrl));
}
