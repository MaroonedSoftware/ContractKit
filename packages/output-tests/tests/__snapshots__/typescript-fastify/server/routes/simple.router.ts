import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { StatusService } from '#src/services/status.service.js';
import { Heartbeat } from '../schemas/simple.schema.js';

/**
 * generated from [simple.ck](../../contracts/simple.ck)
*/
export const SimpleRoutes: FastifyPluginAsync = async app => {

    /**
     * current service status
     * from [simple.ck](../../contracts/simple.ck#L14)
    */
    app.get('/status', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const service = request.container.get(StatusService);
        const result: Heartbeat = await service.get();

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};