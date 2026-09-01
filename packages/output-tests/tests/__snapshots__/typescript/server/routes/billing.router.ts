import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PaymentService } from '#src/services/payment.service.js';
import { AdminCredentialInput, Credential, Payment, PaymentInput, PaymentRef, Session, SessionInput, UpdatePaymentForm } from '../schemas/billing.schema.js';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [billing.ck](file://./../../contracts/billing.ck)
*/
export const BillingRouter = ServerKitRouter();

/**
 * create a payment
 * from [billing.ck](file://./../../contracts/billing.ck#L56)
*/
BillingRouter.post('/payments', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PaymentInput);

    const service = ctx.container.get(PaymentService);
    const result: { body: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean } } = await service.create(body);

    ctx.status = 200;
    ctx.set('x-request-id', String(result.headers["xRequestId"]));
    ctx.set('x-ratelimit-remaining', String(result.headers["xRatelimitRemaining"]));
    if (result.headers["xCacheHit"] !== undefined) ctx.set('x-cache-hit', String(result.headers["xCacheHit"]));
    ctx.type = 'application/json';
    ctx.body = result.body;
});

/**
 * list payments
 * from [billing.ck](file://./../../contracts/billing.ck#L75)
*/
BillingRouter.get('/payments', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            limit: z.coerce.number().int(),
            cursor: z.string(),
        }),
    );

    const headers = await parseAndValidate(
        ctx.headers,
        z.object({
            'api-key': z.string(),
            'x-tenant': z.string(),
        }),
    );

    const service = ctx.container.get(PaymentService);
    const result: Payment[] = await service.list(query, headers);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * fetch one payment
 * from [billing.ck](file://./../../contracts/billing.ck#L97)
*/
BillingRouter.get('/payments/:paymentId', requirePolicy(), async ctx => {
    const { paymentId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const service = ctx.container.get(PaymentService);
    const result: Payment = await service.getById(paymentId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * update a payment with form data
 * from [billing.ck](file://./../../contracts/billing.ck#L106)
*/
BillingRouter.post('/payments/:paymentId', requirePolicy(), bodyParserMiddleware(['urlencoded']), async ctx => {
    const { paymentId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, UpdatePaymentForm);

    const service = ctx.container.get(PaymentService);
    await service.updateWithForm(paymentId, body);

    ctx.status = 204;
});

/**
 * delete a payment — declares only a documented error status
 * from [billing.ck](file://./../../contracts/billing.ck#L117)
*/
BillingRouter.delete('/payments/:paymentId', requirePolicy(), async ctx => {
    const { paymentId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const service = ctx.container.get(PaymentService);
    await service.delete(paymentId);

    ctx.status = 400;
});

/**
 * upload a receipt image
 * from [billing.ck](file://./../../contracts/billing.ck#L131)
*/
BillingRouter.post('/payments/:paymentId/receipt', requirePolicy(), bodyParserMiddleware(['multipart']), async ctx => {
    const { paymentId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const multipartBody = ctx.parsedBody as MultipartBody;

    const service = ctx.container.get(PaymentService);
    const result: Payment = await service.uploadReceipt(paymentId, multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * look up a refund by its originating payment
 * from [billing.ck](file://./../../contracts/billing.ck#L146)
 * @deprecated
*/
BillingRouter.get('/refunds/:paymentId', requirePolicy(), async ctx => {
    const params = await parseAndValidate(ctx.params, PaymentRef.strict());

    const service = ctx.container.get(PaymentService);
    const result: Payment = await service.getRefund(params);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * store a credential
 * from [billing.ck](file://./../../contracts/billing.ck#L160)
*/
BillingRouter.post('/credentials', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, AdminCredentialInput);

    const service = ctx.container.get(PaymentService);
    const result: Credential = await service.createCredential(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * open a session
 * from [billing.ck](file://./../../contracts/billing.ck#L173)
*/
BillingRouter.post('/sessions', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SessionInput);

    const service = ctx.container.get(PaymentService);
    const result: Session = await service.createSession(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
