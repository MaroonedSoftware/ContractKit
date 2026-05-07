import { resolve, isAbsolute } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { computeHash } from './cache.js';
import type { PluginEntry, ResolvedConfig } from './config.js';
import type { ContractKitPlugin, PluginContext } from '@contractkit/core';
import type { FileHashMap } from './cache.js';

export type { ContractKitPlugin };

export interface LoadedPlugin {
    plugin: ContractKitPlugin;
    entry: PluginEntry;
}

export async function loadPlugins(entries: PluginEntry[], configDir: string): Promise<LoadedPlugin[]> {
    const loaded: LoadedPlugin[] = [];
    for (const entry of entries) {
        const { plugin: specifier } = entry;
        const modulePath =
            specifier.startsWith('.') || specifier.startsWith('/') || isAbsolute(specifier)
                ? resolve(configDir, specifier)
                : createRequire(resolve(configDir, 'package.json')).resolve(specifier);
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
        loaded.push({ plugin: raw as ContractKitPlugin, entry });
    }
    return loaded;
}

/**
 * Build the {@link PluginContext} a plugin sees inside its hooks. `emitFile` is
 * only meaningful during `generateTargets`; the default implementation throws if
 * called from `validate` / `transform`. Pass `cacheEnabled=false` (computed by the
 * CLI from `--force` / `cache: false`) so the plugin can bypass its own incremental
 * caches.
 */
export function makePluginContext(
    entry: PluginEntry,
    config: ResolvedConfig,
    cacheEnabled: boolean,
    emitFile?: (outPath: string, content: string) => void,
): PluginContext {
    return {
        rootDir: config.rootDir,
        options: entry.options ?? {},
        cacheEnabled,
        emitFile:
            emitFile ??
            (() => {
                throw new Error('emitFile is only available in generateTargets');
            }),
    };
}

export function computePluginFingerprint(newCache: FileHashMap, cacheKey: string): string {
    const allHashes = Object.values(newCache).sort().join('|') + '|' + cacheKey;
    return computeHash(allHashes);
}

export function pluginOutputsExist(cache: FileHashMap, cacheKey: string): boolean {
    const raw = cache[`__plugin_${cacheKey}__files__`];
    if (!raw) return false;
    const files = (raw as string).split('|').filter(Boolean);
    return files.length > 0 && files.every(f => existsSync(f));
}
