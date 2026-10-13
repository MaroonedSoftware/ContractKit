import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PluginContext } from '@contractkit/core';
import { generateOp } from '../src/codegen-operation.js';
import { planTools } from '../src/codegen-mcp.js';
import { createTypescriptPlugin } from '../src/index.js';
import { FASTIFY_SERVER_FRAMEWORK } from '../src/server-framework-fastify.js';
import { contractRoot, field, model, opOperation, opParam, opResponse, opRoot, opRoute, scalarType } from './helpers.js';

/**
 * A `text/event-stream` response: the router hands the service an `EventSink` and `streamEvents`
 * opens the Server-Sent Events response on the service's first use of it, in place of writing a
 * returned body.
 */

function streamOp(extra: Parameters<typeof opOperation>[1] = {}) {
    return opOperation('get', {
        service: 'ChatService.stream',
        responses: [opResponse(200, 'ChatEvent', 'text/event-stream'), opResponse(404)],
        ...extra,
    });
}

function streamRoot(op = streamOp()) {
    return opRoot([opRoute('/conversations/{id}/stream', [op], [opParam('id', scalarType('uuid'))])], 'chat.ck');
}

describe('streaming routes (Koa)', () => {
    const out = generateOp(streamRoot());

    it('hands the service an event sink and the resume point, after its own arguments', () => {
        expect(out).toContain("const lastEventId = resolveLastEventId(ctx.get('Last-Event-ID'), ctx.query.lastEventId);");
        expect(out).toContain('await streamEvents<ChatEvent>(');
        expect(out).toContain('        () => openSseStream(ctx),');
        expect(out).toContain('        event => JSON.stringify(event),');
        expect(out).toContain('        events => service.stream(id, events, lastEventId),');
    });

    it('writes no status, content type or body of its own', () => {
        const handler = out.slice(out.indexOf("ChatRouter.get('/conversations/:id/stream'"));
        expect(handler).not.toContain('ctx.status');
        expect(handler).not.toContain('ctx.type');
        expect(handler).not.toContain('ctx.body');
    });

    it('declares the EventSink type and streamEvents once, and imports the SSE runtime', () => {
        expect(out.match(/export interface EventSink<T>/g)).toHaveLength(1);
        expect(out.match(/async function streamEvents<T>/g)).toHaveLength(1);
        expect(out).toContain(
            "import { ServerKitRouter, requirePolicy, openSseStream, resolveLastEventId, type SseStream } from '@maroonedsoftware/koa';",
        );
    });

    it('leaves the runtime out of a router with no stream', () => {
        const plain = generateOp(opRoot([opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User')] })])]));
        expect(plain).not.toContain('EventSink');
        expect(plain).not.toContain('SseStream');
    });

    it('writes a bigint-bearing event with the replacer', () => {
        const withBigInt = generateOp(streamRoot(), { modelsWithBigInt: new Set(['ChatEvent']) });
        expect(withBigInt).toContain('event => JSON.stringify(event, bigIntReplacer),');
    });

    it('serializes a date-bearing event the way a JSON body is serialized', () => {
        const out = generateOp(streamRoot(), { modelsWithSerializer: new Set(['ChatEvent']) });
        expect(out).toContain('event => JSON.stringify(serializeChatEvent(event)),');
    });

    it('passes query and headers ahead of the sink, in the usual order', () => {
        const op = streamOp({ query: [opParam('since', scalarType('string'))], headers: [opParam('x-tenant', scalarType('string'))] });
        expect(generateOp(streamRoot(op))).toContain('events => service.stream(id, query, headers, events, lastEventId),');
    });

    it('renames a path parameter that would shadow the sink', () => {
        const root = opRoot([opRoute('/feeds/{events}', [streamOp()], [opParam('events', scalarType('string'))])], 'chat.ck');
        const out = generateOp(root);
        expect(out).toMatch(/events => service\.stream\((\w+), events, lastEventId\)/);
        expect(out).not.toContain('service.stream(events, events');
    });
});

describe('streaming routes (Fastify)', () => {
    const out = generateOp(streamRoot(), { framework: FASTIFY_SERVER_FRAMEWORK });

    it('marks the route as a stream in its config', () => {
        expect(out).toContain(
            "app.get('/conversations/:id/stream', { config: { contractkit: { stream: true } }, preHandler: [requirePolicy()] }, async (request, reply) => {",
        );
    });

    it('opens the reply with the shutdown signal its plugin aborts from preClose', () => {
        expect(out).toContain('            () => openSseReply(reply, { signal: streamShutdown.signal }),');
        expect(out.match(/const streamShutdown = new AbortController\(\);/g)).toHaveLength(1);
        expect(out).toContain("    app.addHook('preClose', async () => streamShutdown.abort());");
    });

    it('reads Last-Event-ID off the headers, falling back to the query', () => {
        expect(out).toContain(
            "const lastEventId = resolveLastEventId(firstQueryValue(request.headers['last-event-id']) ?? '', (request.query as Record<string, unknown>).lastEventId);",
        );
    });

    it('declares the shutdown hook once however many streams the plugin has', () => {
        const root = opRoot([opRoute('/a/stream', [streamOp()]), opRoute('/b/stream', [streamOp()])]);
        expect(generateOp(root, { framework: FASTIFY_SERVER_FRAMEWORK }).match(/addHook\('preClose'/g)).toHaveLength(1);
    });

    it('declares no shutdown hook when the only stream is an internal operation left out', () => {
        const root = opRoot([
            opRoute('/users', [opOperation('get', { responses: [opResponse(200, 'User')] })]),
            opRoute('/feed', [streamOp({ modifiers: ['internal'] })]),
        ]);
        expect(generateOp(root, { framework: FASTIFY_SERVER_FRAMEWORK, includeInternal: false })).not.toContain('preClose');
    });
});

describe('streaming operations and MCP', () => {
    it('never plans a tool for a stream, even one marked mcp', () => {
        expect(planTools(streamRoot(streamOp({ mcp: true })), true)).toEqual([]);
        expect(planTools(streamRoot(streamOp()), true, true)).toEqual([]);
    });

    it('warns when an operation asks for a tool but streams', async () => {
        const warnings: string[] = [];
        const ctx: PluginContext = {
            rootDir: '/project',
            options: {},
            cacheEnabled: false,
            cacheDir: mkdtempSync(join(tmpdir(), 'ck-ts-sse-')),
            emitFile: () => {},
            warn: message => warnings.push(message),
        };
        const plugin = createTypescriptPlugin({ server: { zod: true, output: { types: 'types/{filename}.ts' } }, mcp: {} }, '/project');
        await plugin.generateTargets!(
            {
                contractRoots: [contractRoot([model('ChatEvent', [field('text', scalarType('string'))])], '/project/chat.ck')],
                opRoots: [{ ...streamRoot(streamOp({ mcp: true })), file: '/project/chat.ck' }],
                modelsWithInput: new Set(),
                modelsWithOutput: new Set(),
            },
            ctx,
        );
        expect(warnings).toEqual([expect.stringContaining('GET /conversations/{id}/stream is marked mcp but returns text/event-stream')]);
    });
});
