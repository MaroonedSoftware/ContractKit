import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CacheService, DEFAULT_CACHE_DIR } from '../src/cache.js';

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
});
