import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { SeatService } from '#src/services/seat.service.js';
import { Note, Seat, SeatRef } from '../schemas/reserved.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
*/
export const ReservedRouter = ServerKitRouter();

/**
 * fetch one seat
 * from [reserved.ck](../../contracts/reserved.ck#L48)
*/
ReservedRouter.get('/seats/:class', requirePolicy(), async ctx => {
    const { class: class_ } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            class: z.string(),
        }),
    );

    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
            in: z.string().optional(),
            pageSize: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
        }),
    );

    const headers = await parseAndValidate(
        ctx.headers,
        z.object({
            from: z.string().optional(),
        }),
    );

    const service = ctx.container.get(SeatService);
    const result: { body: Seat; headers: { from?: string } } = await service.getSeat(class_, query, headers);

    ctx.status = 200;
    if (result.headers["from"] !== undefined) ctx.set('from', String(result.headers["from"]));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * fetch a row by its seat class
 * from [reserved.ck](../../contracts/reserved.ck#L74)
*/
ReservedRouter.get('/rows/:class', requirePolicy(), async ctx => {
    const params = await parseAndValidate(ctx.params, SeatRef.strict());

    const service = ctx.container.get(SeatService);
    const result: Seat = await service.getRow(params);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * replace a note
 * from [reserved.ck](../../contracts/reserved.ck#L89)
*/
ReservedRouter.put('/notes/:body', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const { body: body_ } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            body: z.string(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, Note);

    const service = ctx.container.get(SeatService);
    const result: Note = await service.putNote(body_, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
