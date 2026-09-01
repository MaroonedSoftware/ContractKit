import { z } from 'zod';
import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';
import { InvoiceService } from '#src/services/invoice.service.js';
import { Invoice } from '../schemas/hyphenated.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [hyphenated.ck](../../contracts/hyphenated.ck)
*/
export const HyphenatedRouter = ServerKitRouter();

/**
 * fetch an invoice
 * from [hyphenated.ck](../../contracts/hyphenated.ck#L22)
*/
HyphenatedRouter.get('/invoices/:invoiceId', requirePolicy(), async ctx => {
    const { invoiceId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            invoiceId: z.uuid(),
        }),
    );

    const service = ctx.container.get(InvoiceService);
    const result: Invoice = await service.getById(invoiceId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
