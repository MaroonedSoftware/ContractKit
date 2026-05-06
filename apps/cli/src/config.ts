import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DEFAULT_CACHE_DIR } from './cache.js';
import { homedir } from 'node:os';

export interface PluginEntry {
    /** npm package name or local path relative to contractkit.config.json */
    plugin: string;
    /**
     * Plugin-specific options passed as ctx.options.
     *
     * One reserved key: `keys?: Record<string, string>`. Entries are merged across all plugin
     * entries into a workspace-wide fallback map for `{{var}}` substitution in `.ck` files.
     * A file's `options { keys }` block still wins over this fallback when both define a name.
     */
    options?: Record<string, unknown>;
}

/** Record-keyed plugin config: each key is the plugin package name, value is options. */
export type PluginsConfig = Record<string, Record<string, unknown>>;

/** Raw shape of `contractkit.config.json` before CLI flag merge. All fields are optional. */
export interface DslConfig {
    rootDir?: string;
    /**
     * Build/HTTP caching control.
     *   - `true`  — enable, default directory `.contractkit/cache`
     *   - `false` (default) — disabled
     *   - `string` — enabled, treats the value as a custom cache directory (relative to `rootDir` or absolute)
     */
    cache?: boolean | string;
    /** Glob patterns for .ck files to compile, relative to rootDir. */
    patterns?: string[];
    /** Run prettier on generated TypeScript files after compilation. Default: false. */
    prettier?: boolean;
    /** Plugins to load: each key is the plugin package name, value is its options. */
    plugins?: PluginsConfig;
}

/** Resolved cache configuration produced by {@link mergeConfig}. */
export interface ResolvedCacheConfig {
    /** Whether the build/HTTP caches are active. `--force` does NOT flip this — it is gated separately at the CLI. */
    enabled: boolean;
    /** Directory (relative to `rootDir` or absolute) where caches live. */
    dir: string;
}

const CONFIG_FILENAME = 'contractkit.config.json';

/**
 * Load `contractkit.config.json` from an explicit path or by walking up from `startDir`.
 *
 * Returns the parsed config plus the directory that contained it (used to resolve relative
 * paths in the config). When no config is found anywhere on the path, returns an empty
 * config rooted at `startDir`.
 *
 * @throws if `configPath` is provided but the file cannot be read or parsed.
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

/** Fully resolved configuration: file values merged with CLI flags, paths absolutized, plugins normalized. */
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

/**
 * Merge a parsed {@link DslConfig} with CLI flags into a fully resolved configuration.
 *
 * Normalizes `cache` (boolean | string), expands a leading `~` in `rootDir`, resolves
 * `rootDir` to an absolute path, and converts the record-shaped `plugins` block into
 * an ordered `PluginEntry[]`.
 */
export function mergeConfig(config: DslConfig, cliArgs: { watch: boolean; force: boolean }, configDir: string = process.cwd()): ResolvedConfig {
    const cache: ResolvedCacheConfig =
        typeof config.cache === 'string'
            ? { enabled: true, dir: config.cache }
            : { enabled: config.cache === true, dir: DEFAULT_CACHE_DIR };

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
