import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { SeatService } from '#src/services/seat.service.js';
import { Seat, SeatRef } from '../schemas/reserved.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
*/
export const ReservedRouter = ServerKitRouter();

/**
 * fetch one seat
 * from [reserved.ck](../../contracts/reserved.ck#L33)
*/
ReservedRouter.get('/seats/:seatId', requirePolicy(), async ctx => {
    const { seatId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            seatId: z.string(),
        }),
    );

    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            from: z.string().optional(),
            pageSize: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
        }),
    );

    const service = ctx.container.get(SeatService);
    const result: { body: Seat; headers: { from?: string } } = await service.getSeat(seatId, query);

    ctx.status = 200;
    if (result.headers["from"] !== undefined) ctx.set('from', String(result.headers["from"]));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * fetch a row by its seat class
 * from [reserved.ck](../../contracts/reserved.ck#L54)
*/
ReservedRouter.get('/rows/:class', requirePolicy(), async ctx => {
    const params = await parseAndValidate(ctx.params, SeatRef.strict());

    const service = ctx.container.get(SeatService);
    const result: Seat = await service.getRow(params);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
