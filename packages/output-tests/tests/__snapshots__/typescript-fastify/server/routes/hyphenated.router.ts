import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { InvoiceService } from '#src/services/invoice.service.js';
import { Invoice } from '../schemas/hyphenated.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [hyphenated.ck](../../contracts/hyphenated.ck)
*/
export const HyphenatedRoutes: FastifyPluginAsync = async app => {

    /**
     * fetch an invoice
     * from [hyphenated.ck](../../contracts/hyphenated.ck#L22)
    */
    app.get('/invoices/:invoiceId', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const { invoiceId } = await parseAndValidate(
            request.params,
            z.strictObject({
                invoiceId: z.uuid(),
            }),
        );

        const service = request.container.get(InvoiceService);
        const result: Invoice = await service.getById(invoiceId);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};