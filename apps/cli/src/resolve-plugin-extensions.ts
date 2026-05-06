import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { OpRootNode, PluginValue } from '@contractkit/core';
import type { DiagnosticCollector } from '@contractkit/core';
import type { HttpCache } from './cache.js';

const FILE_URL_PREFIX = 'file://';

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
 * files and failed/non-2xx HTTP requests emit warnings and leave the original
 * string in place.
 *
 * Each unique HTTP URL is fetched at most once per CLI invocation; when
 * `options.httpCacheDir` is set, successful responses are persisted there and
 * reused on subsequent runs.
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
                    resolved[name] = await resolveUrls(value, contractDir, root.file, op.loc.line, name, diag, inFlight, httpCache);
                }
                op.pluginExtensions = resolved;
            }
        }
    }
}

async function resolveUrls(
    value: PluginValue,
    contractDir: string,
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
        return Promise.all(value.map(item => resolveUrls(item, contractDir, file, line, pluginName, diag, inFlight, httpCache)));
    }
    if (value !== null && typeof value === 'object') {
        const out: Record<string, PluginValue> = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = await resolveUrls(v, contractDir, file, line, pluginName, diag, inFlight, httpCache);
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
        const res = await fetch(url);
        if (!res.ok) return null;
        const body = await res.text();
        httpCache?.set(url, body);
        return body;
    } catch {
        return null;
    }
}
