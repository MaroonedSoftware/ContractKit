import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    CacheService,
    COMPILER_FINGERPRINT_KEY,
    DEFAULT_CACHE_DIR,
    HTTP_CACHE_MAX_AGE_MS,
    computeHash,
    type HttpCacheEntry,
} from '../src/cache.js';

describe('CacheService', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('uses .contractkit/cache as the default root', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ 'a.ck': 'hash-a' });
        expect(existsSync(join(tmpDir, DEFAULT_CACHE_DIR, 'build.json'))).toBe(true);
    });

    it('round-trips the build cache', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ 'a.ck': 'hash-a', 'b.ck': 'hash-b' });
        const loaded = new CacheService(tmpDir, { enabled: true }).loadBuildCache();
        expect(loaded).toEqual({ 'a.ck': 'hash-a', 'b.ck': 'hash-b' });
    });

    it('round-trips http responses keyed by url', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        const http = service.httpCache();
        expect(http.get('https://example.com/a')).toBeNull();
        http.set('https://example.com/a', 'body-a');
        http.set('https://example.com/b', 'body-b');
        expect(http.get('https://example.com/a')).toBe('body-a');
        expect(http.get('https://example.com/b')).toBe('body-b');
    });

    it('persists http responses across instances pointing at the same dir', () => {
        new CacheService(tmpDir, { enabled: true }).httpCache().set('https://x', 'persisted');
        const reread = new CacheService(tmpDir, { enabled: true }).httpCache().get('https://x');
        expect(reread).toBe('persisted');
    });

    it('honors a custom dir', () => {
        const service = new CacheService(tmpDir, { enabled: true, dir: 'custom-cache' });
        service.saveBuildCache({ x: 'y' });
        expect(existsSync(join(tmpDir, 'custom-cache', 'build.json'))).toBe(true);
    });

    it('build cache and http cache live under the same root', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ 'a.ck': 'hash' });
        service.httpCache().set('https://x', 'body');
        expect(existsSync(join(tmpDir, DEFAULT_CACHE_DIR, 'build.json'))).toBe(true);
        expect(existsSync(join(tmpDir, DEFAULT_CACHE_DIR, 'http'))).toBe(true);
    });

    it('returns empty/null and writes nothing when disabled', () => {
        const service = new CacheService(tmpDir, { enabled: false });
        service.saveBuildCache({ 'a.ck': 'hash' });
        service.httpCache().set('https://x', 'body');
        expect(service.loadBuildCache()).toEqual({});
        expect(service.httpCache().get('https://x')).toBeNull();
        expect(existsSync(join(tmpDir, DEFAULT_CACHE_DIR))).toBe(false);
    });

    it('returns empty when build cache file is corrupted', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ 'a.ck': 'hash' });
        const path = join(tmpDir, DEFAULT_CACHE_DIR, 'build.json');
        // corrupt the JSON
        require('node:fs').writeFileSync(path, '{ not valid json', 'utf-8');
        expect(service.loadBuildCache()).toEqual({});
    });

    it('writes the build cache as pretty JSON', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ 'a.ck': 'hash-a' });
        const raw = readFileSync(join(tmpDir, DEFAULT_CACHE_DIR, 'build.json'), 'utf-8');
        expect(raw).toContain('\n');
    });

    it('returns empty when the compiler fingerprint does not match', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ [COMPILER_FINGERPRINT_KEY]: 'old-fingerprint', 'a.ck': 'hash' });
        // Load with a different fingerprint — entire cache should be treated as empty so codegen reruns.
        const loaded = service.loadBuildCache('new-fingerprint');
        expect(loaded).toEqual({});
    });

    it('returns the stored cache when the compiler fingerprint matches', () => {
        const service = new CacheService(tmpDir, { enabled: true });
        service.saveBuildCache({ [COMPILER_FINGERPRINT_KEY]: 'fp-1', 'a.ck': 'hash' });
        const loaded = service.loadBuildCache('fp-1');
        expect(loaded['a.ck']).toBe('hash');
        expect(loaded[COMPILER_FINGERPRINT_KEY]).toBe('fp-1');
    });

    describe('http cache envelope validation', () => {
        /** Resolve the on-disk path a given url hashes to under the default cache dir. */
        const httpFilePath = (url: string): string => join(tmpDir, DEFAULT_CACHE_DIR, 'http', computeHash(url));

        it('stores a validating JSON envelope, not the bare body', () => {
            const url = 'https://example.com/a';
            new CacheService(tmpDir, { enabled: true }).httpCache().set(url, 'body-a');
            const raw = readFileSync(httpFilePath(url), 'utf-8');
            const entry = JSON.parse(raw) as HttpCacheEntry;
            expect(entry.version).toBe(1);
            expect(entry.url).toBe(url);
            expect(entry.body).toBe('body-a');
            expect(entry.bodyHash).toBe(computeHash('body-a'));
            expect(typeof entry.fetchedAt).toBe('number');
        });

        it('returns null once the entry is past its TTL', () => {
            const url = 'https://example.com/stale';
            // Configure a service so the file path resolution matches, then write a stale envelope directly.
            const service = new CacheService(tmpDir, { enabled: true });
            mkdirSync(join(tmpDir, DEFAULT_CACHE_DIR, 'http'), { recursive: true });
            const stale: HttpCacheEntry = {
                version: 1,
                url,
                fetchedAt: Date.now() - HTTP_CACHE_MAX_AGE_MS - 1000,
                bodyHash: computeHash('old-body'),
                body: 'old-body',
            };
            writeFileSync(httpFilePath(url), JSON.stringify(stale), 'utf-8');
            expect(service.httpCache().get(url)).toBeNull();
        });

        it('honors a configurable httpMaxAgeMs', () => {
            const url = 'https://example.com/short';
            // Zero max-age: even a just-written entry is immediately expired.
            const service = new CacheService(tmpDir, { enabled: true, httpMaxAgeMs: 0 });
            service.httpCache().set(url, 'body');
            expect(service.httpCache().get(url)).toBeNull();
        });

        it('returns null when the stored body no longer matches its bodyHash (tamper)', () => {
            const url = 'https://example.com/tamper';
            const service = new CacheService(tmpDir, { enabled: true });
            service.httpCache().set(url, 'original');
            const path = httpFilePath(url);
            const entry = JSON.parse(readFileSync(path, 'utf-8')) as HttpCacheEntry;
            entry.body = 'tampered'; // bodyHash still points at "original"
            writeFileSync(path, JSON.stringify(entry), 'utf-8');
            expect(service.httpCache().get(url)).toBeNull();
        });

        it('returns null when the envelope url differs from the requested url (key confusion)', () => {
            const url = 'https://example.com/wanted';
            const service = new CacheService(tmpDir, { enabled: true });
            mkdirSync(join(tmpDir, DEFAULT_CACHE_DIR, 'http'), { recursive: true });
            const entry: HttpCacheEntry = {
                version: 1,
                url: 'https://example.com/other', // does not match the key
                fetchedAt: Date.now(),
                bodyHash: computeHash('body'),
                body: 'body',
            };
            writeFileSync(httpFilePath(url), JSON.stringify(entry), 'utf-8');
            expect(service.httpCache().get(url)).toBeNull();
        });

        it('treats a legacy bare-body file as a miss without throwing', () => {
            const url = 'https://example.com/legacy';
            const service = new CacheService(tmpDir, { enabled: true });
            mkdirSync(join(tmpDir, DEFAULT_CACHE_DIR, 'http'), { recursive: true });
            // Old format: the raw body written straight to the sha256(url) path.
            writeFileSync(httpFilePath(url), 'a raw legacy body', 'utf-8');
            expect(() => service.httpCache().get(url)).not.toThrow();
            expect(service.httpCache().get(url)).toBeNull();
        });

        it('get/set are no-ops when the cache is disabled', () => {
            const url = 'https://example.com/disabled';
            const service = new CacheService(tmpDir, { enabled: false });
            service.httpCache().set(url, 'body');
            expect(service.httpCache().get(url)).toBeNull();
            expect(existsSync(join(tmpDir, DEFAULT_CACHE_DIR))).toBe(false);
        });
    });
});
