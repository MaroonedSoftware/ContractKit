import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/fastify';
import { PaymentService } from '#src/services/payment.service.js';
import { AdminCredentialInput, Credential, Payment, PaymentInput, PaymentRef, Session, SessionInput, UpdatePaymentForm } from '../schemas/billing.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [billing.ck](../../contracts/billing.ck)
*/
export const BillingRouter = ServerKitRouter();

/**
 * create a payment
 * from [billing.ck](../../contracts/billing.ck#L56)
*/
BillingRouter.post('/payments', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {
    const body = await parseAndValidate(request.parsedBody, PaymentInput);

    const service = request.container.get(PaymentService);
    const result: { body: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean; xExpiresAfter?: DateTime } } = await service.create(body);

    reply.status(200);
    reply.header('x-request-id', String(result.headers["xRequestId"]));
    reply.header('x-ratelimit-remaining', String(result.headers["xRatelimitRemaining"]));
    if (result.headers["xCacheHit"] !== undefined) reply.header('x-cache-hit', String(result.headers["xCacheHit"]));
    if (result.headers["xExpiresAfter"] !== undefined) reply.header('x-expires-after', String(result.headers["xExpiresAfter"]));
    reply.type('application/json');
    return reply.send(result.body);
});

/**
 * list payments
 * from [billing.ck](../../contracts/billing.ck#L76)
*/
BillingRouter.get('/payments', requirePolicy(), async (request, reply) => {
    const query = await parseAndValidate(
        request.query,
        z.strictObject({
            limit: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(20),
            cursor: z.string(),
        }),
    );

    const headers = await parseAndValidate(
        request.headers,
        z.object({
            'api-key': z.string().optional(),
            'x-tenant': z.string(),
        }),
    );

    const service = request.container.get(PaymentService);
    const result: Payment[] = await service.list(query, headers);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});

/**
 * fetch one payment
 * from [billing.ck](../../contracts/billing.ck#L98)
*/
BillingRouter.get('/payments/:paymentId', requirePolicy(), async (request, reply) => {
    const { paymentId } = await parseAndValidate(
        request.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const service = request.container.get(PaymentService);
    const result: Payment = await service.getById(paymentId);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});

/**
 * update a payment with form data
 * from [billing.ck](../../contracts/billing.ck#L107)
*/
BillingRouter.post('/payments/:paymentId', requirePolicy(), bodyParserMiddleware(['urlencoded']), async (request, reply) => {
    const { paymentId } = await parseAndValidate(
        request.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const body = await parseAndValidate(request.parsedBody, UpdatePaymentForm);

    const service = request.container.get(PaymentService);
    await service.updateWithForm(paymentId, body);

    reply.status(204);
    return reply.send();
});

/**
 * delete a payment — declares only a documented error status
 * from [billing.ck](../../contracts/billing.ck#L118)
*/
BillingRouter.delete('/payments/:paymentId', requirePolicy(), async (request, reply) => {
    const { paymentId } = await parseAndValidate(
        request.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const service = request.container.get(PaymentService);
    await service.delete(paymentId);

    reply.status(204);
    return reply.send();
});

/**
 * upload a receipt image
 * from [billing.ck](../../contracts/billing.ck#L132)
*/
BillingRouter.post('/payments/:paymentId/receipt', requirePolicy(), bodyParserMiddleware(['multipart']), async (request, reply) => {
    const { paymentId } = await parseAndValidate(
        request.params,
        z.strictObject({
            paymentId: z.uuid(),
        }),
    );

    const multipartBody = request.parsedBody as MultipartBody;

    const service = request.container.get(PaymentService);
    const result: Payment = await service.uploadReceipt(paymentId, multipartBody);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});

/**
 * look up a refund by its originating payment
 * from [billing.ck](../../contracts/billing.ck#L147)
 * @deprecated
*/
BillingRouter.get('/refunds/:paymentId', requirePolicy(), async (request, reply) => {
    const params = await parseAndValidate(request.params, PaymentRef.strict());

    const service = request.container.get(PaymentService);
    const result: Payment = await service.getRefund(params);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});

/**
 * store a credential
 * from [billing.ck](../../contracts/billing.ck#L161)
*/
BillingRouter.post('/credentials', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {
    const body = await parseAndValidate(request.parsedBody, AdminCredentialInput);

    const service = request.container.get(PaymentService);
    const result: Credential = await service.createCredential(body);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});

/**
 * open a session
 * from [billing.ck](../../contracts/billing.ck#L174)
*/
BillingRouter.post('/sessions', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {
    const body = await parseAndValidate(request.parsedBody, SessionInput);

    const service = request.container.get(PaymentService);
    const result: Session = await service.createSession(body);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});
