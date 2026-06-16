import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { computeHash } from './cache.js';
import { readNearestPackageVersion } from './compiler-fingerprint.js';
import type { PluginEntry, ResolvedConfig } from './config.js';
import type { ContractKitPlugin, PluginContext, EmitFileOptions } from '@contractkit/core';
import type { FileHashMap } from './cache.js';

export type { ContractKitPlugin };

export interface LoadedPlugin {
    plugin: ContractKitPlugin;
    entry: PluginEntry;
    /** Resolved version from the plugin module's `package.json`. Empty string when the version can't be discovered. */
    version: string;
}

export async function loadPlugins(entries: PluginEntry[], configDir: string): Promise<LoadedPlugin[]> {
    const loaded: LoadedPlugin[] = [];
    const require_ = createRequire(resolve(configDir, 'package.json'));
    for (const entry of entries) {
        const { plugin: specifier } = entry;
        const modulePath =
            specifier.startsWith('.') || specifier.startsWith('/') || isAbsolute(specifier)
                ? resolve(configDir, specifier)
                : require_.resolve(specifier);
        let mod: unknown;
        try {
            mod = await import(modulePath);
        } catch (err) {
            throw new Error(`Failed to load plugin "${specifier}": ${(err as Error).message}`, { cause: err });
        }
        const raw =
            (mod as { default?: ContractKitPlugin; plugin?: ContractKitPlugin }).default ?? (mod as { plugin?: ContractKitPlugin }).plugin ?? mod;
        if (!raw || typeof raw !== 'object' || typeof (raw as { name?: string }).name !== 'string') {
            throw new Error(`Plugin "${specifier}" must export a ContractKitPlugin object with a "name" field.`);
        }
        loaded.push({ plugin: raw as ContractKitPlugin, entry, version: readNearestPackageVersion(modulePath) });
    }
    return loaded;
}

/**
 * Build the {@link PluginContext} a plugin sees inside its hooks. `emitFile` is
 * only meaningful during `generateTargets`; the default implementation throws if
 * called from `validate` / `transform`. Pass `cacheEnabled=false` (computed by the
 * CLI from `--force` / `cache: false`) so the plugin can bypass its own incremental
 * caches. `cacheDir` is the absolute path the CLI uses for its build cache —
 * plugins that persist incremental state should write their manifest there.
 */
export function makePluginContext(
    entry: PluginEntry,
    config: ResolvedConfig,
    cacheEnabled: boolean,
    cacheDir: string,
    emitFile?: (outPath: string, content: string, opts?: EmitFileOptions) => void,
): PluginContext {
    return {
        rootDir: config.rootDir,
        options: entry.options ?? {},
        cacheEnabled,
        cacheDir,
        emitFile:
            emitFile ??
            (() => {
                throw new Error('emitFile is only available in generateTargets');
            }),
    };
}

/**
 * Build the fingerprint stored under `__plugin_<cacheKey>__`. Hashes every
 * source file's content hash from `newCache` plus the cacheKey. When a
 * `pluginVersion` is supplied, it's folded in so a plugin package upgrade
 * invalidates its slice of the cache without disturbing other plugins.
 */
export function computePluginFingerprint(newCache: FileHashMap, cacheKey: string, pluginVersion?: string): string {
    const allHashes = Object.values(newCache).sort().join('|') + '|' + cacheKey + (pluginVersion ? `|v=${pluginVersion}` : '');
    return computeHash(allHashes);
}

export function pluginOutputsExist(cache: FileHashMap, cacheKey: string): boolean {
    const raw = cache[`__plugin_${cacheKey}__files__`];
    if (!raw) return false;
    const files = (raw as string).split('|').filter(Boolean);
    return files.length > 0 && files.every(f => existsSync(f));
}
