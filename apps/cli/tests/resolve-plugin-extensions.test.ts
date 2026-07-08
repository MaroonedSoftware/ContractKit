import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DiagnosticCollector } from '@contractkit/core';
import type { OpRootNode, OpRouteNode, OpOperationNode } from '@contractkit/core';
import { lookup } from 'node:dns/promises';
import { resolvePluginExtensions, isBlockedAddress, assertPublicUrl } from '../src/resolve-plugin-extensions.js';
import { CacheService } from '../src/cache.js';

// Stub DNS so hostname-based SSRF checks don't make real network calls; default
// to a public address so normal `example.com` fetches pass the guard.
vi.mock('node:dns/promises', () => ({
    lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));
const lookupMock = vi.mocked(lookup);

beforeEach(() => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
});

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

/** A minimal successful fetch Response stub matching what fetchUrl reads. */
function okResponse(body: string): Response {
    const bytes = new TextEncoder().encode(body);
    return {
        ok: true,
        status: 200,
        type: 'basic',
        headers: new Headers({ 'content-length': String(bytes.byteLength) }),
        arrayBuffer: async () => bytes.buffer,
    } as unknown as Response;
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
        globalThis.fetch = vi.fn().mockResolvedValue(okResponse(body)) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/req.yml' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: body } });
        expect(diag.hasErrors()).toBe(false);
    });

    it('also handles http:// URLs', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(okResponse('plain')) as unknown as typeof fetch;

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
        const fetchMock = vi.fn().mockResolvedValue(okResponse('cached body'));
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
        const fetchMock = vi.fn().mockResolvedValue(okResponse('body'));
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
        globalThis.fetch = vi.fn().mockResolvedValue(okResponse('good')) as unknown as typeof fetch;
        const op2 = makeOp({ plugins: { bruno: { template: 'https://example.com/fail' } } });
        const root2 = makeRoot(join(tmpDir, 'a.ck'), [makeRoute('/x', [op2])]);
        await resolvePluginExtensions([root2], tmpDir, new DiagnosticCollector(), { httpCache: service.httpCache() });
        expect(op2.pluginExtensions).toEqual({ bruno: { template: 'good' } });
    });

    it('fetches each unique URL only once across operations', async () => {
        const fetchMock = vi.fn().mockResolvedValue(okResponse('shared'));
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

describe('resolvePluginExtensions — file:// path containment', () => {
    let tmpDir: string;
    let projectRoot: string;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-contain-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
        // Project root is a nested subdir so `..` traversal escapes it.
        projectRoot = join(tmpDir, 'project');
        mkdirSync(projectRoot, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('refuses a file:// path that escapes the project root via ..', async () => {
        // A secret living outside the project root.
        writeFileSync(join(tmpDir, 'secret.txt'), 'TOP SECRET', 'utf-8');

        const op = makeOp({ plugins: { bruno: { template: 'file://../secret.txt' } } });
        const root = makeRoot(join(projectRoot, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], projectRoot, diag);

        // URL left in place, secret NOT embedded.
        expect(op.pluginExtensions).toEqual({ bruno: { template: 'file://../secret.txt' } });
        const warnings = diag.getAll().filter(d => d.severity === 'warning');
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.message).toContain('outside project root');
    });

    it('refuses an absolute file:// override outside the project root', async () => {
        const secretPath = join(tmpDir, 'id_rsa');
        writeFileSync(secretPath, 'PRIVATE KEY', 'utf-8');

        const op = makeOp({ plugins: { bruno: { template: `file://${secretPath}` } } });
        const root = makeRoot(join(projectRoot, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], projectRoot, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: `file://${secretPath}` } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('still resolves an in-root file:// path', async () => {
        writeFileSync(join(projectRoot, 'local.txt'), 'in-root content', 'utf-8');

        const op = makeOp({ plugins: { bruno: { template: 'file://./local.txt' } } });
        const root = makeRoot(join(projectRoot, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], projectRoot, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'in-root content' } });
        expect(diag.hasErrors()).toBe(false);
        expect(diag.getAll()).toHaveLength(0);
    });
});

describe('isBlockedAddress', () => {
    it('blocks loopback, private, link-local, and metadata IPv4 ranges', () => {
        expect(isBlockedAddress('127.0.0.1')).toBe(true);
        expect(isBlockedAddress('127.99.1.2')).toBe(true);
        expect(isBlockedAddress('10.0.0.5')).toBe(true);
        expect(isBlockedAddress('172.16.0.1')).toBe(true);
        expect(isBlockedAddress('172.31.255.255')).toBe(true);
        expect(isBlockedAddress('192.168.1.1')).toBe(true);
        expect(isBlockedAddress('169.254.169.254')).toBe(true); // cloud metadata
        expect(isBlockedAddress('0.0.0.0')).toBe(true);
    });

    it('allows public IPv4 addresses', () => {
        expect(isBlockedAddress('93.184.216.34')).toBe(false);
        expect(isBlockedAddress('8.8.8.8')).toBe(false);
        expect(isBlockedAddress('172.32.0.1')).toBe(false); // just outside 172.16/12
    });

    it('blocks loopback and unique/link-local IPv6', () => {
        expect(isBlockedAddress('::1')).toBe(true);
        expect(isBlockedAddress('fc00::1')).toBe(true);
        expect(isBlockedAddress('fd12:3456::1')).toBe(true);
        expect(isBlockedAddress('fe80::1')).toBe(true);
        expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true); // IPv4-mapped loopback
    });

    it('allows public IPv6', () => {
        expect(isBlockedAddress('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
    });
});

describe('assertPublicUrl', () => {
    beforeEach(() => {
        lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    });

    it('refuses loopback IP literal', async () => {
        await expect(assertPublicUrl('http://127.0.0.1/x')).rejects.toThrow();
    });

    it('refuses the cloud metadata address', async () => {
        await expect(assertPublicUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    });

    it('refuses localhost', async () => {
        await expect(assertPublicUrl('http://localhost/x')).rejects.toThrow();
    });

    it('allows a normal public host (resolving to a public IP)', async () => {
        await expect(assertPublicUrl('https://example.com/x')).resolves.toBeUndefined();
    });

    it('refuses a hostname that resolves to a private address (DNS rebinding)', async () => {
        lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }] as never);
        await expect(assertPublicUrl('https://rebind.example/x')).rejects.toThrow();
    });
});

describe('resolvePluginExtensions — SSRF guard integration', () => {
    let tmpDir: string;
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        tmpDir = join(tmpdir(), `contractkit-ssrf-test-${Date.now()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        globalThis.fetch = originalFetch;
    });

    it('does not fetch a blocked private target and leaves the URL in place', async () => {
        const fetchMock = vi.fn();
        globalThis.fetch = fetchMock as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'http://169.254.169.254/latest/meta-data' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(fetchMock).not.toHaveBeenCalled();
        expect(op.pluginExtensions).toEqual({ bruno: { template: 'http://169.254.169.254/latest/meta-data' } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('treats a 3xx redirect as a failure (no redirect following)', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 302,
            type: 'basic',
            headers: new Headers(),
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/redir' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'https://example.com/redir' } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('rejects a response whose content-length exceeds the cap', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            type: 'basic',
            headers: new Headers({ 'content-length': String(6 * 1024 * 1024) }),
            arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/big' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'https://example.com/big' } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('rejects a response whose actual body exceeds the cap despite a small content-length', async () => {
        const bigBody = new Uint8Array(6 * 1024 * 1024);
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            type: 'basic',
            headers: new Headers(),
            arrayBuffer: async () => bigBody.buffer,
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/sneaky' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'https://example.com/sneaky' } });
        expect(diag.getAll().filter(d => d.severity === 'warning')).toHaveLength(1);
    });

    it('accepts a normal in-range public response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            type: 'basic',
            headers: new Headers({ 'content-length': '4' }),
            arrayBuffer: async () => new TextEncoder().encode('okay').buffer,
        }) as unknown as typeof fetch;

        const op = makeOp({ plugins: { bruno: { template: 'https://example.com/ok' } } });
        const root = makeRoot(join(tmpDir, 'api.ck'), [makeRoute('/users', [op])]);
        const diag = new DiagnosticCollector();

        await resolvePluginExtensions([root], tmpDir, diag);

        expect(op.pluginExtensions).toEqual({ bruno: { template: 'okay' } });
        expect(diag.hasErrors()).toBe(false);
    });
});
