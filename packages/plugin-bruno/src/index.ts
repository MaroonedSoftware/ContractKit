import { resolve, basename, dirname } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, rmdirSync } from 'node:fs';
import { generateOpenCollectionIncremental, parseManifest, emptyManifest } from './codegen-bruno.js';
import type { BrunoSecurityScheme } from './codegen-bruno.js';
import { serializeIncrementalManifest } from '@contractkit/core';
import type { ContractKitPlugin, PluginContext, PluginValue, OpRootNode, ContractRootNode, IncrementalManifest } from '@contractkit/core';

/** Filename for the persisted Bruno manifest under the CLI cache directory. */
const CACHE_MANIFEST_FILENAME = 'bruno-manifest.json';

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
     * Map of environment name → variables. Each entry produces a
     * `environments/<name>.yml` file. When omitted, a default `local.yml` is
     * emitted with `baseUrl=http://localhost:3000` and any auth env-var
     * placeholders. When provided, the default is replaced entirely; include
     * auth variables (e.g. `token`) explicitly if you need them.
     */
    environments?: Record<string, Record<string, unknown>>;
}

/** Full plugin options shape read from `ctx.options` — extends {@link BrunoPluginConfig} with the `auth` block. */
export interface BrunoPluginOptions extends BrunoPluginConfig {
    auth?: { defaultScheme: string; schemes?: Record<string, BrunoSecurityScheme> };
}

// ─── Default export: loaded via plugins array, reads config from ctx.options ─

/**
 * Validates a `plugins.bruno` extension entry on an operation. The expected shape is
 * `{ template?: string }`, where `template` is a YAML fragment to deep-merge into the
 * generated request file (typically a `file://...` URL whose contents have already
 * been loaded by the CLI resolver).
 */
export function validateBrunoExtension(value: PluginValue): { errors?: string[] } | void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { errors: [`expected an object, got ${describe(value)}`] };
    }
    const errors: string[] = [];
    for (const [key, val] of Object.entries(value)) {
        if (key === 'template') {
            if (typeof val !== 'string') errors.push(`'template' must be a string, got ${describe(val)}`);
        } else {
            errors.push(`unknown field '${key}' (allowed: template)`);
        }
    }
    return errors.length ? { errors } : undefined;
}

function describe(value: PluginValue): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
}

const plugin: ContractKitPlugin = {
    name: 'bruno',
    validateExtension: validateBrunoExtension,
    async generateTargets({ opRoots, contractRoots }, ctx) {
        const { auth, ...config } = ctx.options as BrunoPluginOptions;
        await runBrunoCodegen(opRoots, contractRoots, ctx, config, auth);
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
 * @param config - Plugin configuration (output paths and feature flags).
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
        validateExtension: validateBrunoExtension,
        async generateTargets({ opRoots, contractRoots }, ctx) {
            // The factory captures rootDir at creation time; ctx.rootDir may differ when the
            // plugin is loaded via a config file, so respect the explicit one passed in here.
            await runBrunoCodegen(opRoots, contractRoots, { ...ctx, rootDir }, config, auth);
        },
    };
}

/**
 * Shared orchestration used by both the default export and {@link createBrunoPlugin}.
 *
 * Reads the prior manifest, runs the cache-aware codegen, deletes any files that
 * are no longer produced, and emits the changed files plus the new manifest. When
 * `ctx.cacheEnabled` is `false` (e.g. `--force`) the prior manifest is ignored so
 * every op regenerates.
 */
async function runBrunoCodegen(
    opRoots: OpRootNode[],
    contractRoots: ContractRootNode[],
    ctx: PluginContext,
    config: BrunoPluginConfig,
    auth: BrunoPluginOptions['auth'],
): Promise<void> {
    const base = config.baseDir ? resolve(ctx.rootDir, config.baseDir) : ctx.rootDir;
    const outDir = resolve(base, config.output ?? 'bruno-collection');
    const collectionName = config.collectionName ?? basename(ctx.rootDir);
    const manifestPath = resolve(ctx.cacheDir, CACHE_MANIFEST_FILENAME);

    const prevManifest: IncrementalManifest = ctx.cacheEnabled ? readManifest(manifestPath) : emptyManifest();

    const result = generateOpenCollectionIncremental(
        opRoots,
        {
            collectionName,
            contractRoots,
            auth,
            randomExamples: config.randomExamples ?? true,
            includeInternal: config.includeInternal,
            environments: config.environments,
        },
        prevManifest,
        relPath => existsSync(resolve(outDir, relPath)),
    );

    deleteStalePaths(outDir, result.deletedPaths);

    for (const { relativePath, content } of result.filesToWrite) {
        ctx.emitFile(resolve(outDir, relativePath), content);
    }

    // Persist the manifest under the CLI cache dir, separate from the bruno output.
    writeManifest(manifestPath, result.manifest);
}

/** Read the previous run's manifest from `manifestPath`. Returns an empty manifest when missing or unreadable. */
function readManifest(manifestPath: string): IncrementalManifest {
    if (!existsSync(manifestPath)) return emptyManifest();
    try {
        return parseManifest(readFileSync(manifestPath, 'utf-8'));
    } catch {
        return emptyManifest();
    }
}

/** Write the manifest to `manifestPath`. Creates parent dirs as needed. Errors are swallowed so a broken cache never blocks the build. */
function writeManifest(manifestPath: string, manifest: IncrementalManifest): void {
    try {
        mkdirSync(dirname(manifestPath), { recursive: true });
        writeFileSync(manifestPath, serializeIncrementalManifest(manifest), 'utf-8');
    } catch {
        // best-effort
    }
}

/**
 * Delete files that the previous run tracked but the current run doesn't produce, then
 * walk back up each affected directory and remove it if it's now empty (stopping at outDir).
 * Anything user-added survives because the manifest only ever lists plugin-generated paths.
 */
function deleteStalePaths(outDir: string, relPaths: string[]): void {
    if (relPaths.length === 0) return;
    const removedDirs = new Set<string>();
    for (const rel of relPaths) {
        const abs = resolve(outDir, rel);
        if (existsSync(abs)) {
            rmSync(abs, { force: true });
            removedDirs.add(dirname(abs));
        }
    }
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

