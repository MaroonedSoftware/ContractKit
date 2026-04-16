import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DEFAULT_CACHE_FILENAME } from './cache.js';
import { homedir } from 'node:os';

export interface PluginEntry {
    /** npm package name or local path relative to contractkit.config.json */
    plugin: string;
    /** Plugin-specific options passed as ctx.options */
    options?: Record<string, unknown>;
}

/** Record-keyed plugin config: each key is the plugin package name, value is options. */
export type PluginsConfig = Record<string, Record<string, unknown>>;

export interface DslConfig {
    rootDir?: string;
    cache?: boolean | string;
    /** Glob patterns for .ck files to compile, relative to rootDir. */
    patterns?: string[];
    /** Run prettier on generated TypeScript files after compilation. Default: false. */
    prettier?: boolean;
    /** Plugins to load: each key is the plugin package name, value is its options. */
    plugins?: PluginsConfig;
}

export interface ResolvedCacheConfig {
    enabled: boolean;
    filename: string;
}

const CONFIG_FILENAME = 'contractkit.config.json';

/**
 * Load config from an explicit path, or search upward from `startDir`
 * for contractkit.config.json.
 */
export function loadConfig(configPath?: string, startDir: string = process.cwd()): { config: DslConfig; configDir: string } {
    if (configPath) {
        const resolved = resolve(configPath);
        try {
            const text = readFileSync(resolved, 'utf-8');
            return { config: JSON.parse(text) as DslConfig, configDir: dirname(resolved) };
        } catch (err) {
            throw new Error(`Failed to load config from ${resolved}: ${(err as Error).message}`, { cause: err });
        }
    }

    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, CONFIG_FILENAME);
        try {
            const text = readFileSync(candidate, 'utf-8');
            return { config: JSON.parse(text) as DslConfig, configDir: dir };
        } catch {
            // File not found or invalid -- walk up
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return { config: {}, configDir: resolve(startDir) };
}

export interface ResolvedConfig {
    patterns: string[];
    rootDir: string;
    cache: ResolvedCacheConfig;
    watch: boolean;
    force: boolean;
    prettier: boolean;
    plugins: PluginEntry[];
    configDir: string;
}

function normalizePlugins(plugins: PluginsConfig | undefined): PluginEntry[] {
    if (!plugins) return [];
    return Object.entries(plugins).map(([name, options]) => ({ plugin: name, options }));
}

/** Merge config file values with CLI flags. */
export function mergeConfig(config: DslConfig, cliArgs: { watch: boolean; force: boolean }, configDir: string = process.cwd()): ResolvedConfig {
    const cache: ResolvedCacheConfig =
        typeof config.cache === 'string'
            ? { enabled: true, filename: config.cache }
            : { enabled: config.cache === true, filename: DEFAULT_CACHE_FILENAME };

    let rootDir = config.rootDir ?? '.';
    if (rootDir.startsWith('~')) {
        rootDir = homedir() + rootDir.slice(1);
    }

    return {
        patterns: config.patterns ?? [],
        rootDir: resolve(rootDir),
        cache,
        watch: cliArgs.watch,
        force: cliArgs.force,
        prettier: config.prettier ?? false,
        plugins: normalizePlugins(config.plugins),
        configDir,
    };
}
