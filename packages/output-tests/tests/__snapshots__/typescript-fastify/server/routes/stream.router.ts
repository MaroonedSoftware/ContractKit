import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy, openSseReply, resolveLastEventId, firstQueryValue, type SseStream } from '@maroonedsoftware/fastify';
import { ChatService } from '#src/services/chat.service.js';
import { ChatStreamEvent } from '../schemas/stream.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';

/**
 * What a streaming operation's service writes its events to. The response opens the first time the
 * service uses the sink (send, onClose or signal), so it can still throw an error status before then,
 * and it ends when the service method settles.
 */
export interface EventSink<T> {
    /** Send one event. A client echoes the last id back as Last-Event-ID when it reconnects. A no-op once closed. */
    send(event: T, options?: { id?: string | number; event?: string }): void;
    /** Run cleanup when the stream closes, for any reason. Runs at once if it already has. */
    onClose(listener: () => void): void;
    /** True once the stream has closed. */
    readonly closed: boolean;
    /** Aborts when the stream closes: the client left, the server is shutting down, or the service settled. */
    readonly signal: AbortSignal;
}

/**
 * Run a streaming service against an EventSink over the stream open() starts, opening it on the
 * service's first use. A throw before then answers the request like any other error; after it, the
 * response already belongs to the stream, which is closed before the error propagates to be logged.
 */
async function streamEvents<T>(open: () => SseStream, serialize: (event: T) => string, run: (events: EventSink<T>) => Promise<unknown>): Promise<void> {
    let stream: SseStream | undefined;
    const closed = new AbortController();
    const use = (): SseStream => {
        if (stream === undefined) {
            stream = open();
            stream.onClose(() => closed.abort());
        }
        return stream;
    };
    const events: EventSink<T> = {
        send: (event, options) => use().event({ ...options, data: serialize(event) }),
        onClose: listener => use().onClose(listener),
        get closed() {
            return stream?.closed ?? false;
        },
        get signal() {
            use();
            return closed.signal;
        },
    };
    try {
        await run(events);
    } catch (error) {
        stream?.close();
        throw error;
    }
    use().close();
}

/**
 * generated from [stream.ck](../../contracts/stream.ck)
*/
export const StreamRoutes: FastifyPluginAsync = async app => {

    // Ends this plugin's open event streams as shutdown begins. ServerKit closes Fastify when its
    // lifecycle signal aborts, and `preClose` runs before the server waits on open sockets.
    const streamShutdown = new AbortController();
    app.addHook('preClose', async () => streamShutdown.abort());

    /**
     * from [stream.ck](../../contracts/stream.ck) `GET /conversations/{id}/stream`
    */
    app.get('/conversations/:id/stream', { config: { contractkit: { stream: true } }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const { id } = await parseAndValidate(
            request.params,
            z.strictObject({
                id: z.uuid(),
            }),
        );

        const service = request.container.get(ChatService);
        const lastEventId = resolveLastEventId(firstQueryValue(request.headers['last-event-id']) ?? '', (request.query as Record<string, unknown>).lastEventId);
        await streamEvents<ChatStreamEvent>(
            () => openSseReply(reply, { signal: streamShutdown.signal }),
            event => JSON.stringify(event, bigIntReplacer),
            events => service.stream(id, events, lastEventId),
        );
    });

};