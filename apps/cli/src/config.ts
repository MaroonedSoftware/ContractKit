import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DEFAULT_CACHE_FILENAME } from './cache.js';
import { homedir } from 'node:os';

export interface TypesConfig {
    output?: string;
    include?: string[];
}

export interface RoutesConfig {
    output?: string;
    include?: string[];
    servicePathTemplate?: string;
    typeImportPathTemplate?: string;
}

export interface SdkTypesConfig {
    output?: string;
    include?: string[];
}

export interface SdkClientsConfig {
    output?: string;
    include?: string[];
    typeImportPathTemplate?: string;
}

export interface SdkConfig {
    baseDir?: string;
    name?: string;
    output?: string;
    types?: SdkTypesConfig;
    clients?: SdkClientsConfig;
}

export interface ServerConfig {
    baseDir?: string;
    types?: TypesConfig;
    routes?: RoutesConfig;
}

export interface DslConfig {
    rootDir?: string;
    cache?: boolean | string;
    server?: ServerConfig;
    sdk?: SdkConfig;
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
    rootDir: string;
    cache: ResolvedCacheConfig;
    server: Required<ServerConfig>;
    sdk?: SdkConfig;
    watch: boolean;
    force: boolean;
}

/** Merge config file values with CLI flags. */
export function mergeConfig(config: DslConfig, cliArgs: { watch: boolean; force: boolean }): ResolvedConfig {
    const types = config.server?.types ?? {};
    const routes = config.server?.routes ?? {};
    const sdk = config.sdk;
    const patterns = [...(types.include ?? []), ...(routes.include ?? []), ...(sdk?.types?.include ?? []), ...(sdk?.clients?.include ?? []), ...(config.patterns ?? [])];

    const cache: ResolvedCacheConfig =
        typeof config.cache === 'string'
            ? { enabled: true, filename: config.cache }
            : { enabled: config.cache === true, filename: DEFAULT_CACHE_FILENAME };

    let rootDir = config.rootDir ?? '.';
    if (rootDir.startsWith('~')) {
        rootDir = homedir() + rootDir.slice(1);
    }

    return {
        patterns,
        rootDir: resolve(rootDir),
        cache,
        server: { baseDir: config.server?.baseDir ?? '.', types, routes },
        sdk,
        watch: cliArgs.watch,
        force: cliArgs.force,
    };
}
