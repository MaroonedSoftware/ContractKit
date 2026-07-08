import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { lookup } from 'node:dns/promises';
import type { OpRootNode, PluginValue } from '@contractkit/core';
import type { DiagnosticCollector } from '@contractkit/core';
import type { HttpCache } from './cache.js';

const FILE_URL_PREFIX = 'file://';

/** Abort an outbound plugin-extension fetch after this many milliseconds. */
const HTTP_TIMEOUT_MS = 10_000;
/** Reject a plugin-extension response body larger than this many bytes. */
const MAX_HTTP_BYTES = 5 * 1024 * 1024;

/**
 * Returns true when `p` (the result of `relative(root, target)`) indicates the
 * target escapes `root` — i.e. it walks up out of the tree (`..`) or is an
 * absolute path (different drive/root). Callers pass `relative(root, target)`.
 */
function escapesRoot(rel: string): boolean {
    return rel === '..' || rel.startsWith(`..${'/'}`) || rel.startsWith('..\\') || isAbsolute(rel);
}

/**
 * Returns true when `ip` is a loopback, private, link-local, or unique-local
 * address that plugin-extension fetches must never reach (SSRF guard). Accepts
 * both IPv4 dotted-quad and IPv6 literals (including IPv4-mapped IPv6).
 */
export function isBlockedAddress(ip: string): boolean {
    let host = ip.trim().toLowerCase();
    // Strip zone id (e.g. fe80::1%eth0) and brackets.
    const pct = host.indexOf('%');
    if (pct !== -1) host = host.slice(0, pct);
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

    // IPv4-mapped / IPv4-compatible IPv6 (e.g. ::ffff:127.0.0.1) → check the IPv4 tail.
    const mapped = host.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) host = mapped[1]!;

    if (host.includes(':')) return isBlockedIpv6(host);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return isBlockedIpv4(host);
    return false;
}

function isBlockedIpv4(host: string): boolean {
    const parts = host.split('.').map(n => Number(n));
    if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. cloud metadata)
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    return false;
}

function isBlockedIpv6(host: string): boolean {
    if (host === '::1') return true; // loopback
    if (host === '::') return true; // unspecified
    const first = host.split(':')[0] ?? '';
    const head = parseInt(first || '0', 16);
    if (Number.isNaN(head)) return true;
    if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
    if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    return false;
}

/**
 * Throws when `url`'s host is a literal private/loopback/link-local address, is
 * `localhost`, or resolves (via DNS) to any such address. Resolving all A/AAAA
 * records and rejecting if ANY is blocked mitigates DNS-rebinding on this
 * pre-fetch check. Callers should treat a throw as "leave the URL in place".
 *
 * @throws if the host is `localhost`, a blocked IP literal, or resolves to any
 * blocked address.
 */
export async function assertPublicUrl(url: string): Promise<void> {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) {
        throw new Error(`refusing to fetch loopback host: ${host}`);
    }
    // IP literal (URL hostname strips the brackets from IPv6).
    if (isBlockedAddress(host)) {
        throw new Error(`refusing to fetch private/loopback address: ${host}`);
    }
    // Hostname → resolve and reject if any address is blocked.
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(host) && !host.includes(':')) {
        const records = await lookup(host, { all: true });
        for (const { address } of records) {
            if (isBlockedAddress(address)) {
                throw new Error(`host ${host} resolves to blocked address ${address}`);
            }
        }
    }
}

/** Options for {@link resolvePluginExtensions}. */
export interface ResolvePluginExtensionsOptions {
    /**
     * Persistent HTTP response cache. Successful responses are written through
     * `set` and reused via `get` on subsequent runs. Omit to disable disk
     * caching entirely (e.g. for `--force`).
     */
    httpCache?: HttpCache;
}

/**
 * Resolves URL strings inside operation `plugins` JSON values.
 *
 * For each operation that declares a `plugins` block, walks the JSON tree of
 * every entry and replaces:
 *   - `file://<path>` strings with the contents of the file (path is resolved
 *     relative to the operation's `.ck` source file).
 *   - `http://<url>` / `https://<url>` strings with the response body of a GET
 *     request to that URL.
 *
 * The transformed tree is stored as `op.pluginExtensions[name]`. Strings without
 * a recognized URL prefix and non-string leaves pass through unchanged. Missing
 * files, `file://` paths that escape `rootDir`, and failed/blocked/non-2xx HTTP
 * requests emit warnings and leave the original string in place.
 *
 * `file://` reads are contained to `rootDir` and outbound HTTP is guarded against
 * SSRF (private/loopback/link-local targets, DNS rebinding, redirects, oversized
 * bodies). Each unique HTTP URL is fetched at most once per CLI invocation; when
 * `options.httpCache` is provided, successful responses are persisted through it
 * and reused on subsequent runs.
 */
export async function resolvePluginExtensions(
    roots: OpRootNode[],
    rootDir: string,
    diag: DiagnosticCollector,
    options: ResolvePluginExtensionsOptions = {},
): Promise<void> {
    const inFlight = new Map<string, Promise<string | null>>();
    const httpCache = options.httpCache;

    for (const root of roots) {
        const contractDir = dirname(resolve(rootDir, root.file));
        for (const route of root.routes) {
            for (const op of route.operations) {
                if (!op.plugins) continue;
                const resolved: Record<string, PluginValue> = {};
                for (const [name, value] of Object.entries(op.plugins)) {
                    resolved[name] = await resolveUrls(value, contractDir, rootDir, root.file, op.loc.line, name, diag, inFlight, httpCache);
                }
                op.pluginExtensions = resolved;
            }
        }
    }
}

async function resolveUrls(
    value: PluginValue,
    contractDir: string,
    rootDir: string,
    file: string,
    line: number,
    pluginName: string,
    diag: DiagnosticCollector,
    inFlight: Map<string, Promise<string | null>>,
    httpCache: HttpCache | undefined,
): Promise<PluginValue> {
    if (typeof value === 'string') {
        if (value.startsWith(FILE_URL_PREFIX)) {
            const relPath = value.slice(FILE_URL_PREFIX.length);
            const absPath = resolve(contractDir, relPath);
            // Containment: reject `..` traversal and absolute overrides that would
            // read a file outside the project root and embed it into generated output.
            const rel = relative(rootDir, absPath);
            if (escapesRoot(rel)) {
                diag.warn(file, line, `plugins.${pluginName}: refusing to read file outside project root: ${relPath}`);
                return value;
            }
            if (!existsSync(absPath)) {
                diag.warn(file, line, `plugins.${pluginName}: file not found: ${relPath}`);
                return value;
            }
            return readFileSync(absPath, 'utf-8');
        }
        if (value.startsWith('http://') || value.startsWith('https://')) {
            let pending = inFlight.get(value);
            if (!pending) {
                pending = fetchUrl(value, httpCache);
                inFlight.set(value, pending);
            }
            const fetched = await pending;
            if (fetched === null) {
                diag.warn(file, line, `plugins.${pluginName}: failed to fetch ${value}`);
                return value;
            }
            return fetched;
        }
        return value;
    }
    if (Array.isArray(value)) {
        return Promise.all(value.map(item => resolveUrls(item, contractDir, rootDir, file, line, pluginName, diag, inFlight, httpCache)));
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, PluginValue> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = await resolveUrls(v, contractDir, rootDir, file, line, pluginName, diag, inFlight, httpCache);
        }
        return out;
    }
    return value;
}

async function fetchUrl(url: string, httpCache: HttpCache | undefined): Promise<string | null> {
    if (httpCache) {
        const cached = httpCache.get(url);
        if (cached !== null) return cached;
    }
    try {
        // SSRF guard: refuse loopback/private/link-local/metadata targets before
        // the request goes out (resolving hostnames to catch DNS-based bypass).
        await assertPublicUrl(url);

        const res = await fetch(url, {
            signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
            // Refuse redirects outright — following them would bypass the pre-fetch
            // SSRF check by bouncing to a private/internal target.
            redirect: 'manual',
        });
        // A manual-mode 3xx (or opaqueredirect) is treated as a failure.
        if (res.status >= 300 && res.status < 400) return null;
        if (res.type === 'opaqueredirect') return null;
        if (!res.ok) return null;

        // Size cap: reject via the advertised content-length first (cheap), then
        // guard the actual decoded byte length after reading.
        const contentLength = Number(res.headers.get('content-length'));
        if (Number.isFinite(contentLength) && contentLength > MAX_HTTP_BYTES) return null;

        const buf = await res.arrayBuffer();
        if (buf.byteLength > MAX_HTTP_BYTES) return null;
        const body = new TextDecoder('utf-8').decode(buf);

        httpCache?.set(url, body);
        return body;
    } catch {
        return null;
    }
}
