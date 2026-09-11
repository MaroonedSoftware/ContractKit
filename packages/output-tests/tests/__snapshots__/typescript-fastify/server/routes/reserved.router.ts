import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { SeatService } from '#src/services/seat.service.js';
import { Note, Seat, SeatRef } from '../schemas/reserved.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
*/
export const ReservedRoutes: FastifyPluginAsync = async app => {

    /**
     * fetch one seat
     * from [reserved.ck](../../contracts/reserved.ck#L48)
    */
    app.get('/seats/:class', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const { class: class_ } = await parseAndValidate(
            request.params,
            z.strictObject({
                class: z.string(),
            }),
        );

        const query = await parseAndValidate(
            request.query,
            z.strictObject({
                from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(),
                in: z.string().optional(),
                pageSize: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
            }),
        );

        const headers = await parseAndValidate(
            request.headers,
            z.object({
                from: z.string().optional(),
            }),
        );

        const service = request.container.get(SeatService);
        const result: { body: Seat; headers: { from?: string } } = await service.getSeat(class_, query, headers);

        reply.status(200);
        if (result.headers["from"] !== undefined) reply.header('from', String(result.headers["from"]));
        reply.type('application/json');
        return reply.send(result.body);
    });

    /**
     * fetch a row by its seat class
     * from [reserved.ck](../../contracts/reserved.ck#L74)
    */
    app.get('/rows/:class', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const params = await parseAndValidate(request.params, SeatRef.strict());

        const service = request.container.get(SeatService);
        const result: Seat = await service.getRow(params);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * replace a note
     * from [reserved.ck](../../contracts/reserved.ck#L89)
    */
    app.put('/notes/:body', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const { body: body_ } = await parseAndValidate(
            request.params,
            z.strictObject({
                body: z.string(),
            }),
        );

        const body = await parseAndValidate(request.body, Note);

        const service = request.container.get(SeatService);
        const result: Note = await service.putNote(body_, body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};