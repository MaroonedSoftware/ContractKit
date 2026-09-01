import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { StatusService } from '#src/services/status.service.js';
import { Heartbeat } from '../schemas/simple.schema.js';

/**
 * generated from [simple.ck](../../contracts/simple.ck)
*/
export const SimpleRouter = ServerKitRouter();

/**
 * current service status
 * from [simple.ck](../../contracts/simple.ck#L14)
*/
SimpleRouter.get('/status', requirePolicy(), async ctx => {
    const service = ctx.container.get(StatusService);
    const result: Heartbeat = await service.get();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
