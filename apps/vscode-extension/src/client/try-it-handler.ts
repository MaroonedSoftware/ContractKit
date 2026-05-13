import * as vscode from 'vscode';

/** Payload posted by the webview when the user clicks "Send" in a Try-it form. */
export interface TryItRequest {
    /** Stable id of the operation being invoked (matches operationAnchor in explorer-ui). */
    operationId: string;
    method: string;
    /** Fully-resolved URL with path params substituted. */
    url: string;
    headers: Record<string, string>;
    /** Plain-text body. Empty string if there's no body. */
    body: string;
    /** Auto-set when the operation declares a JSON body. */
    isJsonBody: boolean;
}

/** Result returned from {@link performTryIt} and forwarded to the webview for display. */
export interface TryItResponse {
    operationId: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    /** Truncated to 256 KiB. */
    body: string;
    /** Total response size in bytes, before truncation. */
    bytes: number;
    /** True when `body` is a UTF-8 decoded text/JSON payload. */
    isText: boolean;
    elapsedMs: number;
    /** Set when the request failed before a response (network error, invalid URL, etc.). */
    error?: string;
}

const MAX_BODY_BYTES = 256 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Performs the HTTP request initiated from a Try-it form in the webview. Runs in the extension host
 * (Node), so it bypasses the webview's CSP `connect-src` restriction and can talk to any origin
 * the user's machine can reach.
 */
export async function performTryIt(request: TryItRequest): Promise<TryItResponse> {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const init: RequestInit = {
            method: request.method.toUpperCase(),
            headers: request.headers,
            signal: controller.signal,
        };
        if (request.body && init.method !== 'GET' && init.method !== 'HEAD') {
            init.body = request.body;
            if (request.isJsonBody && !findHeader(request.headers, 'content-type')) {
                (init.headers as Record<string, string>) = {
                    ...request.headers,
                    'Content-Type': 'application/json',
                };
            }
        }

        const response = await fetch(request.url, init);
        const buf = await response.arrayBuffer();
        const responseHeaders = headersToRecord(response.headers);
        const { body, isText } = decodeBody(buf, responseHeaders);

        return {
            operationId: request.operationId,
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            body,
            bytes: buf.byteLength,
            isText,
            elapsedMs: Date.now() - start,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            operationId: request.operationId,
            status: 0,
            statusText: '',
            headers: {},
            body: '',
            bytes: 0,
            isText: true,
            elapsedMs: Date.now() - start,
            error: message,
        };
    } finally {
        clearTimeout(timer);
    }
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower) return v;
    }
    return undefined;
}

function headersToRecord(headers: Headers): Record<string, string> {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
        out[key] = value;
    });
    return out;
}

function decodeBody(buf: ArrayBuffer, headers: Record<string, string>): { body: string; isText: boolean } {
    const truncated = buf.byteLength > MAX_BODY_BYTES ? buf.slice(0, MAX_BODY_BYTES) : buf;
    const contentType = (findHeader(headers, 'content-type') ?? '').toLowerCase();
    const looksText =
        contentType.includes('json') ||
        contentType.includes('text/') ||
        contentType.includes('xml') ||
        contentType.includes('javascript') ||
        contentType.includes('html');
    if (!looksText && buf.byteLength === 0) return { body: '', isText: true };
    if (!looksText) return { body: `<${buf.byteLength} bytes of ${contentType || 'binary data'}>`, isText: false };
    try {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        const text = decoder.decode(truncated);
        if (contentType.includes('json')) {
            try {
                return { body: JSON.stringify(JSON.parse(text), null, 2), isText: true };
            } catch {
                return { body: text, isText: true };
            }
        }
        return { body: text, isText: true };
    } catch {
        return { body: `<${buf.byteLength} bytes>`, isText: false };
    }
}

/** Resolve the Try-it base URL from settings, falling back to an empty string when unset. */
export function getTryItBaseUrl(): string {
    return vscode.workspace.getConfiguration('contractkit').get<string>('tryItOut.baseUrl') ?? '';
}
