import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { ChatService } from '#src/services/chat.service.js';
import { ChatStreamEvent } from '../schemas/stream.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [stream.ck](../../contracts/stream.ck)
*/
export const StreamRouter = ServerKitRouter();

/**
 * from [stream.ck](../../contracts/stream.ck) `GET /conversations/{id}/stream`
*/
StreamRouter.get('/conversations/:id/stream', requirePolicy(), async ctx => {
    const { id } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            id: z.uuid(),
        }),
    );

    const service = ctx.container.get(ChatService);
    const result: ChatStreamEvent = await service.stream(id);

    ctx.status = 200;
    ctx.type = 'text/event-stream';
    ctx.body = result;
});
