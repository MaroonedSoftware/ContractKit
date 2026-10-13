import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { ChatService } from '#src/services/chat.service.js';
import { ChatStreamEvent } from '../schemas/stream.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [stream.ck](../../contracts/stream.ck)
*/
export const StreamRoutes: FastifyPluginAsync = async app => {

    /**
     * from [stream.ck](../../contracts/stream.ck) `GET /conversations/{id}/stream`
    */
    app.get('/conversations/:id/stream', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const { id } = await parseAndValidate(
            request.params,
            z.strictObject({
                id: z.uuid(),
            }),
        );

        const service = request.container.get(ChatService);
        const result: ChatStreamEvent = await service.stream(id);

        reply.status(200);
        reply.type('text/event-stream');
        return reply.send(result);
    });

};