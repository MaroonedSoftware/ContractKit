import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiagnosticCollector } from '@contractkit/core';
import type { OpRootNode, OpRouteNode, OpOperationNode } from '@contractkit/core';
import { resolvePluginExtensions } from '../src/resolve-plugin-extensions.js';
import { CacheService } from '../src/cache.js';

function makeOp(overrides: Partial<OpOperationNode> = {}): OpOperationNode {
    return {
        method: 'get',
        responses: [],
        loc: { file: 'test.ck', line: 1 },
        ...overrides,
    };
}

function makeRoute(path: string, operations: OpOperationNode[]): OpRouteNode {
    return { path, operations, loc: { file: 'test.ck', line: 1 } };
}

function makeRoot(file: string, routes: OpRouteNode[]): OpRootNode {
    return { kind: 'opRoot', meta: {}, routes, file };
}

describe('resolvePluginExtensions', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-resolve-test-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('replaces a file:// URL string with the file contents', async () => {
        const content = 'info:\n  name: Custom Request\n  type: http\n';
        writeFileSync(join(tmpDir, 'stub.yml'), content, 'utf-8');

        const op = makeOp({ plugins: { bruno: { template: 'file://stub.yml' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: content } });
        expect(diag.hasErrors()).toBe(false);
    });

    it('warns and leaves the original string when the file is missing', async () => {
        const op = makeOp({ plugins: { bruno: { template: 'file://missing.yml' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'file://missing.yml' } });
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('missing.yml');
    });

    it('resolves the file path relative to the contract file directory', async () => {
        const subDir = join(tmpDir, 'contracts');
        mkdirSync(subDir, { recursive: true });
        writeFileSync(join(subDir, 'override.yml'), 'content', 'utf-8');

        const op = makeOp({ plugins: { bruno: { template: 'file://override.yml' } } });
        const root = makeRoot(join(subDir, 'users.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'content' } });
        expect(diag.hasErrors()).toBe(false);
    });

    it('skips ops without a plugins block', async () => {
        const op = makeOp();
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toBeUndefined();
        expect(diag.getAll()).toHaveLength(0);
    });

    it('passes through non-string and non-URL leaves unchanged', async () => {
        const op = makeOp({
            plugins: {
                misc: { count: 3, enabled: true, label: 'plain', tags: ['a', 'b'], absent: null },
            },
        });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({
            misc: { count: 3, enabled: true, label: 'plain', tags: ['a', 'b'], absent: null },
        });
    });

    it('walks nested objects and arrays to resolve every file:// URL', async () => {
        writeFileSync(join(tmpDir, 'a.yml'), 'aaa', 'utf-8');
        writeFileSync(join(tmpDir, 'b.yml'), 'bbb', 'utf-8');

        const op = makeOp({
            plugins: {
                bruno: {
                    fragments: ['file://a.yml', { nested: 'file://b.yml' }],
                },
            },
        });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({
            bruno: { fragments: ['aaa', { nested: 'bbb' }] },
        });
    });
});

describe('resolvePluginExtensions — http(s) URLs', () => {
    let tmpDir: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-resolve-http-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        globalThis.fetch = originalFetch;
    });

    it('replaces an https URL with the response body', async () => {
        const body = 'info:\n  name: Remote Request\n';
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => body,
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/req.yml' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: body } });
        expect(diag.hasErrors()).toBe(false);
    });

    it('also handles http:// URLs', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => 'plain',
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'http://example.com/x' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'plain' } });
    });

    it('warns and leaves the URL when the response is non-2xx', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            text: async () => 'not found',
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/missing' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'https://example.com/missing' } });
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('failed to fetch');
    });

    it('warns and leaves the URL when fetch throws', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/x' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'https://example.com/x' } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('persists fetched bodies via the http cache and reuses them on subsequent runs', async () => {
        const service = new CacheService(tmpDir, { enabled: true });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => 'cached body',
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        // First run — populates the cache.
        const op1 = makeOp({ plugins: { bruno: { template: 'https://example.com/persist' } } });
        const root1 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op1])]);
        await resolvePluginExtensions([root1], tmpDir, new DiagnosticCollector(), { httpCache: service.httpCache() });
        expect(op1.pluginExtensions).toEqual({ bruno: { template: 'cached body' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        // Second run with a fresh service pointing at the same dir — fetch should NOT be called.
        const service2 = new CacheService(tmpDir, { enabled: true });
        const op2 = makeOp({ plugins: { bruno: { template: 'https://example.com/persist' } } });
        const root2 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op2])]);
        await resolvePluginExtensions([root2], tmpDir, new DiagnosticCollector(), { httpCache: service2.httpCache() });
        expect(op2.pluginExtensions).toEqual({ bruno: { template: 'cached body' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not write to disk when httpCache is omitted', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => 'body',
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const op1 = makeOp({ plugins: { bruno: { template: 'https://example.com/no-cache' } } });
        const root1 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op1])]);
        await resolvePluginExtensions([root1], tmpDir, new DiagnosticCollector());

        // Re-run with a fresh cache map — without disk cache, fetch is called again.
        const op2 = makeOp({ plugins: { bruno: { template: 'https://example.com/no-cache' } } });
        const root2 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op2])]);
        await resolvePluginExtensions([root2], tmpDir, new DiagnosticCollector());

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('does not cache non-2xx responses', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            text: async () => 'oops',
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/fail' } } });
        const root = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op])]);
        const service = new CacheService(tmpDir, { enabled: true });
        await resolvePluginExtensions([root], tmpDir, new DiagnosticCollector(), { httpCache: service.httpCache() });

        // Re-run with a working response — must hit the network again, not return the failed body from disk.
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => 'good' }) as unknown as typeof fetch;
        const op2 = makeOp({ plugins: { bruno: { template: 'https://example.com/fail' } } });
        const root2 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op2])]);
        await resolvePluginExtensions([root2], tmpDir, new DiagnosticCollector(), { httpCache: service.httpCache() });
        expect(op2.pluginExtensions).toEqual({ bruno: { template: 'good' } });
    });

    it('fetches each unique URL only once across operations', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => 'shared',
        });
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const op1 = makeOp({ plugins: { bruno: { template: 'https://example.com/shared' } } });
        const op2 = makeOp({ plugins: { bruno: { template: 'https://example.com/shared' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [
            makeRoute('/a', [op1]),
            makeRoute('/b', [op2]),
        ]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op1.pluginExtensions).toEqual({ bruno: { template: 'shared' } });
        expect(op2.pluginExtensions).toEqual({ bruno: { template: 'shared' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
