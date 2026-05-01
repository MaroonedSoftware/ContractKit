import { resolve, basename, dirname } from 'node:path';
import { existsSync, readFileSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { generateOpenCollection, MANIFEST_FILENAME, parseManifest, mergePluginFile } from './codegen-bruno.js';
import type { BrunoSecurityScheme } from './codegen-bruno.js';
import type { ContractKitPlugin } from '@contractkit/core';

/** Configuration accepted by the Bruno plugin, both via `contractkit.config.json` and `createBrunoPlugin`. */
export interface BrunoPluginConfig {
    baseDir?: string;
    output?: string;
    collectionName?: string;
    /**
     * When true (default), example values use Bruno's faker templates
     * (`{{$randomUUID}}`, `{{$randomEmail}}`, etc.) so each send produces
     * fresh data. Set to false for deterministic placeholders.
     */
    randomExamples?: boolean;
    /**
     * Whether to generate request files for operations marked `internal`. Defaults to
     * `true` — Bruno collections are typically used by the team that owns the API and
     * benefit from full coverage. Set to `false` to omit internal ops.
     */
    includeInternal?: boolean;
    /**
     * Directory containing YAML override files, resolved relative to `rootDir`.
     * The directory mirrors the generated output structure — a file at
     * `<overrideDir>/payments/get-payment.yml` is deep-merged into the generated
     * `payments/get-payment.yml`. Arrays in the override replace the generated
     * array entirely. Files with no matching override are emitted unchanged.
     */
    overrideDir?: string;
}

/** Full plugin options shape read from `ctx.options` — extends {@link BrunoPluginConfig} with the `auth` block. */
export interface BrunoPluginOptions extends BrunoPluginConfig {
    auth?: { defaultScheme: string; schemes?: Record<string, BrunoSecurityScheme> };
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

const plugin: ContractKitPlugin = {
    name: 'bruno',
    cacheKey: 'bruno',
    async generateTargets({ opRoots, contractRoots }, ctx) {
        const { auth, ...config } = ctx.options as BrunoPluginOptions;
        const base = config.baseDir ? resolve(ctx.rootDir, config.baseDir) : ctx.rootDir;
        const outDir = resolve(base, config.output ?? 'bruno-collection');
        const collectionName = config.collectionName ?? basename(ctx.rootDir);

        cleanupTrackedFiles(outDir);

        const overrideDirAbs = config.overrideDir ? resolve(ctx.rootDir, config.overrideDir) : undefined;
        const files = generateOpenCollection(opRoots, {
            collectionName,
            contractRoots,
            auth,
            randomExamples: config.randomExamples ?? true,
            includeInternal: config.includeInternal,
        });
        for (const { relativePath, content } of files) {
            ctx.emitFile(resolve(outDir, relativePath), applyDirOverride(relativePath, content, overrideDirAbs));
        }
    },
};

export default plugin;

// ─── Factory: for programmatic use with explicit config ────────────────────

/**
 * Creates a Bruno plugin instance with explicit configuration, for programmatic use.
 *
 * Prefer the default export when loading via `contractkit.config.json`. Use this
 * factory when constructing the plugin in code (e.g. in tests or custom build scripts).
 *
 * @param config - Plugin configuration (output paths, feature flags, overrides).
 * @param rootDir - Absolute path used to resolve relative paths in `config`.
 * @param auth - Optional auth scheme configuration mirroring the `auth` key in plugin options.
 */
export function createBrunoPlugin(
    config: BrunoPluginConfig,
    rootDir: string,
    auth?: { defaultScheme: string; schemes?: Record<string, BrunoSecurityScheme> },
): ContractKitPlugin {
    return {
        name: 'bruno',
        cacheKey: `bruno:${JSON.stringify(config)}`,
        async generateTargets({ opRoots, contractRoots }, ctx) {
            const base = config.baseDir ? resolve(rootDir, config.baseDir) : rootDir;
            const outDir = resolve(base, config.output ?? 'bruno-collection');
            const collectionName = config.collectionName ?? basename(rootDir);

            cleanupTrackedFiles(outDir);

            const overrideDirAbs = config.overrideDir ? resolve(rootDir, config.overrideDir) : undefined;
            const files = generateOpenCollection(opRoots, {
                collectionName,
                contractRoots,
                auth,
                randomExamples: config.randomExamples ?? true,
            });
            for (const { relativePath, content } of files) {
                ctx.emitFile(resolve(outDir, relativePath), applyDirOverride(relativePath, content, overrideDirAbs));
            }
        },
    };
}

function applyDirOverride(relativePath: string, content: string, overrideDirAbs: string | undefined): string {
    if (!overrideDirAbs || relativePath === MANIFEST_FILENAME) return content;
    const overrideFile = resolve(overrideDirAbs, relativePath);
    if (!existsSync(overrideFile)) return content;
    return mergePluginFile(content, readFileSync(overrideFile, 'utf-8'));
}

/**
 * Delete files this plugin generated on the previous run, leaving anything
 * the user added (custom .bru files, scripts, secrets, etc.) untouched.
 *
 * On first run — or after manual deletion of the manifest — nothing is
 * removed; stale files from prior versions linger until manually cleaned.
 */
function cleanupTrackedFiles(outDir: string): void {
    const manifestPath = resolve(outDir, MANIFEST_FILENAME);
    if (!existsSync(manifestPath)) return;

    let tracked: string[];
    try {
        tracked = parseManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return;
    }

    const removedDirs = new Set<string>();
    for (const rel of tracked) {
        const abs = resolve(outDir, rel);
        if (existsSync(abs)) {
            rmSync(abs, { force: true });
            removedDirs.add(dirname(abs));
        }
    }

    // Walk up from each affected directory and remove it if empty, stopping at outDir.
    for (const dir of removedDirs) {
        let current = dir;
        while (current.startsWith(outDir) && current !== outDir) {
            try {
                if (readdirSync(current).length === 0) {
                    rmdirSync(current);
                    current = dirname(current);
                } else {
                    break;
                }
            } catch {
                break;
            }
        }
    }
}
