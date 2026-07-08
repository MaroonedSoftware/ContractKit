import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';

/** Default directory (relative to `rootDir`) where all CLI caches live. */
export const DEFAULT_CACHE_DIR = '.contractkit/cache';
const BUILD_CACHE_FILENAME = 'build.json';
const HTTP_CACHE_DIRNAME = 'http';

/** Default maximum age of a cached HTTP response before it is treated as a miss (24 hours). */
export const HTTP_CACHE_MAX_AGE_MS = 86_400_000;

/**
 * On-disk representation of a cached HTTP response. Stored as JSON so a read can
 * validate integrity (`bodyHash`), freshness (`fetchedAt`), and key identity
 * (`url`) before trusting the body. Legacy bare-body files predate this envelope
 * and fail the `JSON.parse`/`version` check, so they read as a miss.
 */
export interface HttpCacheEntry {
    version: 1;
    /** The URL this entry was fetched from; guards against hash-collision / key confusion. */
    url: string;
    /** Epoch milliseconds when the body was fetched; used for TTL expiry. */
    fetchedAt: number;
    /** `computeHash(body)` at write time; re-checked on read to detect tampering. */
    bodyHash: string;
    /** The cached response body. Only trusted after `bodyHash`, `url`, and TTL checks pass. */
    body: string;
}

/** Map of source file path → sha256 hex of its content (or synthetic keys like `__plugin_<key>__`). */
export interface FileHashMap {
    [filePath: string]: string;
}

/** Synthetic cache key recording the compiler-stack version. A mismatch on load invalidates the entire cache. */
export const COMPILER_FINGERPRINT_KEY = '__compiler__';

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

/** Construction options for {@link CacheService}. */
export interface CacheServiceOptions {
    /** When false, every read returns empty/null and every write is a no-op. */
    enabled: boolean;
    /** Directory (relative to `rootDir` or absolute) used as the cache root. Defaults to `.contractkit/cache`. */
    dir?: string;
    /** Maximum age of a cached HTTP response before it is treated as a miss. Defaults to {@link HTTP_CACHE_MAX_AGE_MS}. */
    httpMaxAgeMs?: number;
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
    private readonly httpMaxAgeMs: number;

    constructor(rootDir: string, options: CacheServiceOptions) {
        this.enabled = options.enabled;
        this.root = resolve(rootDir, options.dir ?? DEFAULT_CACHE_DIR);
        this.buildCachePath = join(this.root, BUILD_CACHE_FILENAME);
        this.httpCacheDir = join(this.root, HTTP_CACHE_DIRNAME);
        this.httpMaxAgeMs = options.httpMaxAgeMs ?? HTTP_CACHE_MAX_AGE_MS;
    }

    /**
     * Load the previous run's `FileHashMap` from disk, or return `{}` when
     * disabled, unreadable, or stamped with a different compiler fingerprint.
     * When `expectedFingerprint` is provided and doesn't match the cache's
     * stored `__compiler__` key, the cache is treated as empty so an upgrade
     * of `@contractkit/core` (or any plugin that influences codegen) forces a
     * full rebuild on the next run.
     */
    loadBuildCache(expectedFingerprint?: string): FileHashMap {
        if (!this.enabled) return {};
        try {
            const cache = JSON.parse(readFileSync(this.buildCachePath, 'utf-8')) as FileHashMap;
            if (expectedFingerprint !== undefined && cache[COMPILER_FINGERPRINT_KEY] !== expectedFingerprint) return {};
            return cache;
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

    /**
     * Read a previously cached HTTP body for `url`. Returns the body only when the
     * stored {@link HttpCacheEntry} is well-formed AND passes every guard:
     *   - JSON parses and `version === 1`,
     *   - `entry.url === url` (defends against hash-collision / key confusion),
     *   - `computeHash(entry.body) === entry.bodyHash` (tamper detection),
     *   - the entry is within TTL (`Date.now() - entry.fetchedAt < httpMaxAgeMs`).
     * Any failure — miss, disabled, read/parse error, mismatch, expiry, or a
     * legacy bare-body file — returns `null` so the caller re-fetches.
     */
    getHttpResponse(url: string): string | null {
        if (!this.enabled) return null;
        const path = this.urlPath(url);
        if (!existsSync(path)) return null;
        try {
            const entry = JSON.parse(readFileSync(path, 'utf-8')) as HttpCacheEntry;
            if (entry?.version !== 1) return null;
            if (entry.url !== url) return null;
            if (typeof entry.body !== 'string' || computeHash(entry.body) !== entry.bodyHash) return null;
            if (typeof entry.fetchedAt !== 'number' || Date.now() - entry.fetchedAt >= this.httpMaxAgeMs) return null;
            return entry.body;
        } catch {
            return null;
        }
    }

    /**
     * Persist an HTTP response body keyed by the URL's sha256, wrapped in an
     * {@link HttpCacheEntry} envelope so reads can validate integrity, freshness,
     * and key identity. No-op when disabled; write errors are swallowed.
     */
    setHttpResponse(url: string, body: string): void {
        if (!this.enabled) return;
        try {
            mkdirSync(this.httpCacheDir, { recursive: true });
            const entry: HttpCacheEntry = {
                version: 1,
                url,
                fetchedAt: Date.now(),
                bodyHash: computeHash(body),
                body,
            };
            writeFileSync(this.urlPath(url), JSON.stringify(entry), 'utf-8');
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
