import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DEFAULT_CACHE_FILENAME } from './cache.js';
import { homedir } from 'node:os';

export interface DtoConfig {
    output?: string;
    include?: string[];
}

export interface RoutesConfig {
    output?: string;
    include?: string[];
    servicePathTemplate?: string;
    typeImportPathTemplate?: string;
}

export interface DslConfig {
    baseDir?: string;
    cache?: boolean | string;
    dto?: DtoConfig;
    routes?: RoutesConfig;
    patterns?: string[];
}

export interface ResolvedCacheConfig {
    enabled: boolean;
    filename: string;
}

const CONFIG_FILENAME = 'contract-dsl.config.json';

/**
 * Load config from an explicit path, or search upward from `startDir`
 * for contract-dsl.config.json.
 */
export function loadConfig(configPath?: string, startDir: string = process.cwd()): DslConfig {
    if (configPath) {
        const resolved = resolve(configPath);
        try {
            const text = readFileSync(resolved, 'utf-8');
            return JSON.parse(text) as DslConfig;
        } catch (err) {
            throw new Error(`Failed to load config from ${resolved}: ${(err as Error).message}`);
        }
    }

    let dir = resolve(startDir);
    while (true) {
        const candidate = join(dir, CONFIG_FILENAME);
        try {
            const text = readFileSync(candidate, 'utf-8');
            return JSON.parse(text) as DslConfig;
        } catch {
            // File not found or invalid -- walk up
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    return {};
}

export interface ResolvedConfig {
    patterns: string[];
    baseDir: string;
    cache: ResolvedCacheConfig;
    dto: DtoConfig;
    routes: RoutesConfig;
    watch: boolean;
    force: boolean;
}

/** Merge config file values with CLI flags. */
export function mergeConfig(config: DslConfig, cliArgs: { watch: boolean; force: boolean }): ResolvedConfig {
    const dto = config.dto ?? {};
    const routes = config.routes ?? {};
    const patterns = [...(dto.include ?? []), ...(routes.include ?? []), ...(config.patterns ?? [])];

    const cache: ResolvedCacheConfig =
        typeof config.cache === 'string'
            ? { enabled: true, filename: config.cache }
            : { enabled: config.cache === true, filename: DEFAULT_CACHE_FILENAME };

    let baseDir = config.baseDir ?? '.';
    if (baseDir.startsWith('~')) {
        baseDir = homedir() + baseDir.slice(1);
    }

    return {
        patterns,
        baseDir: resolve(baseDir),
        cache,
        dto,
        routes,
        watch: cliArgs.watch,
        force: cliArgs.force,
    };
}
