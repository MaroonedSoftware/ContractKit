import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { DEFAULT_CACHE_FILENAME } from './cache.js';
import { homedir } from 'node:os';
import type { OpenApiServerEntry, OpenApiSecurityScheme, OpenApiConfig } from '@maroonedsoftware/contractkit';
export type { OpenApiServerEntry, OpenApiSecurityScheme, OpenApiConfig };

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

export interface HmacSecurityScheme {
    type: 'hmac';
    /** Request header carrying the signature (e.g. 'X-Signature'). */
    header: string;
    /** Name of the environment variable holding the HMAC secret. */
    secretEnv: string;
    /** HMAC algorithm passed to createHmac (e.g. 'sha256', 'sha512'). */
    algorithm: string;
    /** Output encoding for hmac.digest() ('hex' | 'base64' | 'base64url'). */
    digest: 'hex' | 'base64' | 'base64url';
}

export type SecuritySchemeConfig = OpenApiSecurityScheme | HmacSecurityScheme;

/** Type guard — narrows a SecuritySchemeConfig to HmacSecurityScheme. */
export function isHmacScheme(scheme: SecuritySchemeConfig): scheme is HmacSecurityScheme {
    return 'secretEnv' in scheme;
}

export interface SecurityConfig {
    /** Global default security scheme name used when an operation has no explicit security declaration. */
    default?: string;
    /** Security scheme definitions. HMAC schemes generate inline middleware; OpenAPI schemes are emitted into components.securitySchemes. */
    schemes?: Record<string, SecuritySchemeConfig>;
}

export interface MarkdownConfig {
    baseDir?: string;
    output?: string;
}

export interface BrunoConfig {
    baseDir?: string;
    output?: string;
    collectionName?: string;
}

export interface DocsConfig {
    openapi?: OpenApiConfig;
    markdown?: MarkdownConfig;
    bruno?: BrunoConfig;
}

export interface DslConfig {
    rootDir?: string;
    cache?: boolean | string;
    server?: ServerConfig;
    sdk?: SdkConfig;
    docs?: DocsConfig;
    patterns?: string[];
    /** Run prettier on generated TypeScript files after compilation. Default: false. */
    prettier?: boolean;
    /** Security configuration: default scheme and scheme definitions. */
    security?: SecurityConfig;
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
    docs?: DocsConfig;
    security?: SecurityConfig;
    watch: boolean;
    force: boolean;
    prettier: boolean;
}

/** Merge config file values with CLI flags. */
export function mergeConfig(config: DslConfig, cliArgs: { watch: boolean; force: boolean }): ResolvedConfig {
    const types = config.server?.types ?? {};
    const routes = config.server?.routes ?? {};
    const sdk = config.sdk;
    const patterns = [
        ...(types.include ?? []),
        ...(routes.include ?? []),
        ...(sdk?.types?.include ?? []),
        ...(sdk?.clients?.include ?? []),
        ...(config.patterns ?? []),
    ];

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
        docs: config.docs,
        security: config.security,
        watch: cliArgs.watch,
        force: cliArgs.force,
        prettier: config.prettier ?? false,
    };
}
