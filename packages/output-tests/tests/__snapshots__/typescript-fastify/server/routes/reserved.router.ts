import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { SeatService } from '#src/services/seat.service.js';
import { Seat, SeatRef } from '../schemas/reserved.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [reserved.ck](../../contracts/reserved.ck)
*/
export const ReservedRoutes: FastifyPluginAsync = async app => {

    /**
     * fetch one seat
     * from [reserved.ck](../../contracts/reserved.ck#L32)
    */
    app.get('/seats/:seatId', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const { seatId } = await parseAndValidate(
            request.params,
            z.strictObject({
                seatId: z.string(),
            }),
        );

        const query = await parseAndValidate(
            request.query,
            z.strictObject({
                from: z.string().optional(),
                pageSize: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
            }),
        );

        const service = request.container.get(SeatService);
        const result: { body: Seat; headers: { from?: string } } = await service.getSeat(seatId, query);

        reply.status(200);
        if (result.headers["from"] !== undefined) reply.header('from', String(result.headers["from"]));
        reply.type('application/json');
        return reply.send(result.body);
    });

    /**
     * fetch a row by its seat class
     * from [reserved.ck](../../contracts/reserved.ck#L53)
    */
    app.get('/rows/:class', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const params = await parseAndValidate(request.params, SeatRef.strict());

        const service = request.container.get(SeatService);
        const result: Seat = await service.getRow(params);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};