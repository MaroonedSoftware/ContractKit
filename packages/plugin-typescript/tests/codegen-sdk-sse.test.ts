import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { generateAreaClient, generateSdk, generateSdkOptions } from '../src/codegen-sdk.js';
import { opRoot, opRoute, opOperation, opParam, opResponse, scalarType } from './helpers.js';

/**
 * A `text/event-stream` response: the client method returns an `SseEventStream` of the declared
 * event type rather than buffering the body, and `parseSse` turns the bytes into events.
 */

const SHARED = { sdkOptionsPath: '/x/sdk-options.ts', outPath: '/x/chat.client.ts' };

function streamRoot(extra: Parameters<typeof opOperation>[1] = {}) {
    return opRoot([
        opRoute(
            '/conversations/{id}/stream',
            [
                opOperation('get', {
                    sdk: 'streamConversation',
                    responses: [opResponse(200, 'ChatEvent', 'text/event-stream'), opResponse(404)],
                    ...extra,
                }),
            ],
            [opParam('id', scalarType('uuid'))],
        ),
    ]);
}

describe('streaming client methods', () => {
    it('returns an SseEventStream of the event type and takes optional request options', () => {
        const out = generateSdk(streamRoot(), SHARED);
        expect(out).toContain('async streamConversation(id: string, requestOptions?: SseRequestOptions): Promise<SseEventStream<ChatEvent>> {');
        expect(out).toContain('headers: sseRequestHeaders(requestOptions),');
        expect(out).toContain('signal: requestOptions?.signal,');
        expect(out).toContain('return parseSse<ChatEvent>(result);');
        expect(out).not.toContain('result.text()');
    });

    it('imports the streaming runtime from the shared options file, and nothing it does not use', () => {
        const out = generateSdk(streamRoot(), SHARED);
        expect(out).toContain("import type { SdkFetch, SseEventStream, SseRequestOptions } from './sdk-options.js';");
        expect(out).toContain("import { parseSse, sseRequestHeaders } from './sdk-options.js';");
        expect(out).not.toContain('parseJson');
        expect(out).not.toContain('bigIntReviver');
    });

    it('spreads custom header params alongside the streaming headers', () => {
        const out = generateSdk(streamRoot({ headers: [opParam('x-tenant', scalarType('string'))] }), SHARED);
        expect(out).toContain('headers: { ...buildHeaders(customHeaders), ...sseRequestHeaders(requestOptions) },');
    });

    it('revives bigint fields in each event when the event type carries one', () => {
        const out = generateSdk(streamRoot(), { ...SHARED, modelsWithBigInt: new Set(['ChatEvent']) });
        expect(out).toContain('return parseSse<ChatEvent>(result, data => JSON.parse(data, bigIntReviver) as ChatEvent);');
        expect(out).toContain("import { parseSse, sseRequestHeaders, bigIntReviver } from './sdk-options.js';");
    });

    it('declares the streaming runtime inline when there is no shared options file', () => {
        const out = generateSdk(streamRoot());
        expect(out).toContain('export function parseSse<T>(');
        expect(out).toContain('export function sseRequestHeaders(');
        expect(out).toContain('export interface SseEventStream<T>');
    });

    it('leaves the runtime out of an inline file with no stream', () => {
        const root = opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User')] })])]);
        expect(generateSdk(root)).not.toContain('parseSse');
    });

    it('carries the streaming imports into an area client', () => {
        const out = generateAreaClient({
            area: 'chat',
            outPath: '/x/chat/chat.client.ts',
            inlineFiles: [{ root: streamRoot(), codegenOptions: { outPath: '/x/chat/chat.client.ts', sdkOptionsPath: '/x/sdk-options.ts' } }],
            subareaClients: [],
            sdkOptionsPath: '/x/sdk-options.ts',
        });
        expect(out).toContain("import type { SdkFetch, SseEventStream, SseRequestOptions } from '../sdk-options.js';");
        expect(out).toContain("import { parseSse, sseRequestHeaders } from '../sdk-options.js';");
    });
});

// ─── Runtime ──────────────────────────────────────────────────────────────

type ParseSse = <T>(res: Response, parse?: (data: string) => T) => AsyncIterable<T> & { readonly lastEventId: string | undefined };

/** Transpile and evaluate a generated module as CommonJS. */
function evaluate(source: string, scope: Record<string, unknown>): Record<string, unknown> {
    const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const exports: Record<string, unknown> = {};
    new Function('exports', ...Object.keys(scope), js)(exports, ...Object.values(scope));
    return exports;
}

/** A `text/event-stream` response delivering `chunks` one network read at a time. */
function sseResponse(chunks: string[], onCancel?: () => void, status = 200): Response {
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
            else controller.close();
        },
        cancel() {
            onCancel?.();
        },
    });
    return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } });
}

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
    const out: T[] = [];
    for await (const event of stream) out.push(event);
    return out;
}

describe('parseSse', () => {
    const { parseSse } = evaluate(generateSdkOptions(), { fetch: undefined, crypto: undefined }) as { parseSse: ParseSse };

    it('parses JSON events and tracks the last event id', async () => {
        const stream = parseSse(sseResponse(['id: 1\ndata: {"n":1}\n\n', 'id: 2\nevent: tick\ndata: {"n":2}\n\n']));
        expect(await collect(stream)).toEqual([{ n: 1 }, { n: 2 }]);
        expect(stream.lastEventId).toBe('2');
    });

    it('reassembles a frame split across reads, including a CRLF split down the middle', async () => {
        const stream = parseSse(sseResponse(['da', 'ta: {"n"', ':1}\r', '\n\r\n', 'data: {"n":2}\r\r']));
        expect(await collect(stream)).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it('joins multi-line data with newlines and skips comments and unknown fields', async () => {
        const stream = parseSse(sseResponse([': ping\n\n', 'retry: 5000\ndata: line one\ndata:line two\n\n']), (data: string) => data);
        expect(await collect(stream)).toEqual(['line one\nline two']);
    });

    it('drops an event the stream ended in the middle of', async () => {
        const stream = parseSse(sseResponse(['data: {"n":1}\n\n', 'data: {"n":2}\n']));
        expect(await collect(stream)).toEqual([{ n: 1 }]);
    });

    it('applies the parse callback to each event', async () => {
        const stream = parseSse(sseResponse(['data: {"n":1}\n\n']), (data: string) => ({ ...JSON.parse(data), revived: true }));
        expect(await collect(stream)).toEqual([{ n: 1, revived: true }]);
    });

    it('cancels the body when the caller stops iterating early', async () => {
        let cancelled = false;
        const stream = parseSse(
            sseResponse(['data: 1\n\n', 'data: 2\n\n', 'data: 3\n\n'], () => (cancelled = true)),
            (data: string) => Number(data),
        );
        for await (const event of stream) {
            expect(event).toBe(1);
            break;
        }
        expect(cancelled).toBe(true);
    });

    it('can be iterated only once', async () => {
        const stream = parseSse(sseResponse(['data: 1\n\n']));
        await collect(stream);
        expect(() => stream[Symbol.asyncIterator]()).toThrow(/only once/);
    });
});

describe('a generated streaming method, end to end', () => {
    /** The shared options file and a client with one stream method, wired to a stub `fetch`. */
    function client(fetchStub: (url: string, init: RequestInit) => Promise<Response>) {
        const options = evaluate(generateSdkOptions(), { fetch: fetchStub, crypto: { randomUUID: () => 'req-1' } });
        const clientSource = generateSdk(streamRoot(), SHARED);
        const module = evaluate(clientSource, { require: () => options });
        const createSdkFetch = options.createSdkFetch as (o: { baseUrl: string; headers?: Record<string, string> }) => unknown;
        const Client = module[Object.keys(module).find(k => k.endsWith('Client'))!] as new (fetch: unknown) => {
            streamConversation(
                id: string,
                options?: { signal?: AbortSignal; lastEventId?: string },
            ): Promise<AsyncIterable<unknown> & { lastEventId?: string }>;
        };
        return new Client(createSdkFetch({ baseUrl: 'https://api.test', headers: { Authorization: 'Bearer t' } }));
    }

    it('goes through createSdkFetch with the auth, Accept and Last-Event-ID headers and the signal', async () => {
        const seen: { url: string; init: RequestInit }[] = [];
        const api = client(async (url, init) => {
            seen.push({ url, init });
            return sseResponse(['id: 8\ndata: {"text":"hi"}\n\n']);
        });
        const controller = new AbortController();
        const stream = await api.streamConversation('c1', { signal: controller.signal, lastEventId: '7' });
        expect(await collect(stream)).toEqual([{ text: 'hi' }]);
        expect(stream.lastEventId).toBe('8');

        expect(seen[0]!.url).toBe('https://api.test/conversations/c1/stream');
        expect(seen[0]!.init.signal).toBe(controller.signal);
        expect(seen[0]!.init.headers).toMatchObject({
            Authorization: 'Bearer t',
            'X-Request-ID': 'req-1',
            Accept: 'text/event-stream',
            'Last-Event-ID': '7',
        });
    });

    it('throws SdkError on a non-2xx response, as a buffered method does', async () => {
        const api = client(async () => new Response('{"error":"gone"}', { status: 404, statusText: 'Not Found' }));
        await expect(api.streamConversation('c1')).rejects.toMatchObject({ name: 'SdkError', status: 404, body: { error: 'gone' } });
    });
});
