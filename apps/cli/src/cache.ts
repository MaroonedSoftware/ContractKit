import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';

/** Default directory (relative to `rootDir`) where all CLI caches live. */
export const DEFAULT_CACHE_DIR = '.contractkit/cache';
const BUILD_CACHE_FILENAME = 'build.json';
const HTTP_CACHE_DIRNAME = 'http';

/** Map of source file path → sha256 hex of its content (or synthetic keys like `__plugin_<key>__`). */
export interface FileHashMap {
    [filePath: string]: string;
}

/** Compute a stable sha256 hex digest for a string of content. */
export function computeHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
}

/**
 * Minimal key-value interface for plugin extension HTTP responses. `get` returns
 * `null` on a cache miss; `set` is best-effort and silently swallows write
 * failures so a broken cache never blocks the build.
 */
export interface HttpCache {
    get(url: string): string | null;
    set(url: string, body: string): void;
}

export interface CacheServiceOptions {
    /** When false, every read returns empty/null and every write is a no-op. */
    enabled: boolean;
    /** Directory (relative to `rootDir` or absolute) used as the cache root. Defaults to `.contractkit/cache`. */
    dir?: string;
}

/**
 * Unified cache service. Owns one root directory under which both the build
 * cache (file/plugin hashes, single JSON file) and the HTTP response cache
 * (one blob per URL hash) live.
 *
 * Layout:
 *   <root>/build.json              — FileHashMap from the previous run
 *   <root>/http/<sha256(url)>      — fetched HTTP response bodies
 *
 * When `enabled` is false the service is a no-op: reads return empty/null and
 * writes do nothing. Disk failures (corrupted JSON, unwritable directory) fall
 * through to the empty/null path so a broken cache never fails the build.
 */
export class CacheService {
    readonly enabled: boolean;
    readonly root: string;
    private readonly buildCachePath: string;
    private readonly httpCacheDir: string;

    constructor(rootDir: string, options: CacheServiceOptions) {
        this.enabled = options.enabled;
        this.root = resolve(rootDir, options.dir ?? DEFAULT_CACHE_DIR);
        this.buildCachePath = join(this.root, BUILD_CACHE_FILENAME);
        this.httpCacheDir = join(this.root, HTTP_CACHE_DIRNAME);
    }

    /** Load the previous run's `FileHashMap` from disk, or return `{}` when disabled or unreadable. */
    loadBuildCache(): FileHashMap {
        if (!this.enabled) return {};
        try {
            return JSON.parse(readFileSync(this.buildCachePath, 'utf-8'));
        } catch {
            return {};
        }
    }

    /** Persist a `FileHashMap` for the next run. No-op when disabled; write errors are swallowed. */
    saveBuildCache(cache: FileHashMap): void {
        if (!this.enabled) return;
        try {
            mkdirSync(dirname(this.buildCachePath), { recursive: true });
            writeFileSync(this.buildCachePath, JSON.stringify(cache, null, 2), 'utf-8');
        } catch {
            // best-effort
        }
    }

    /** HTTP cache view backed by this service, suitable for passing into the plugin-extension resolver. */
    httpCache(): HttpCache {
        return {
            get: (url) => this.getHttpResponse(url),
            set: (url, body) => this.setHttpResponse(url, body),
        };
    }

    private urlPath(url: string): string {
        return join(this.httpCacheDir, computeHash(url));
    }

    /** Read a previously cached HTTP body for `url`, or `null` on miss / when disabled / on read error. */
    getHttpResponse(url: string): string | null {
        if (!this.enabled) return null;
        const path = this.urlPath(url);
        if (!existsSync(path)) return null;
        try {
            return readFileSync(path, 'utf-8');
        } catch {
            return null;
        }
    }

    /** Persist an HTTP response body keyed by the URL's sha256. No-op when disabled; write errors are swallowed. */
    setHttpResponse(url: string, body: string): void {
        if (!this.enabled) return;
        try {
            mkdirSync(this.httpCacheDir, { recursive: true });
            writeFileSync(this.urlPath(url), body, 'utf-8');
        } catch {
            // best-effort
        }
    }
}

/**
 * Returns true when `filePath`'s `content` no longer matches the hash stored in
 * `cache`, or when `outPath` does not exist on disk. Used by plugin output
 * gating to decide whether a file needs regeneration.
 */
export function isFileChanged(filePath: string, content: string, outPath: string, cache: FileHashMap): boolean {
    if (!existsSync(outPath)) return true;
    const currentHash = computeHash(content);
    return cache[filePath] !== currentHash;
}
