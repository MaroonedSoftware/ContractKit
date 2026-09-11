import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { PaymentService } from '#src/services/payment.service.js';
import { AdminCredentialInput, Credential, Payment, PaymentFilter, PaymentInput, PaymentRef, PaymentScope, SavedSearch, ScopedFilter, Session, SessionInput, SnakeFilter, SnakeHeaders, TenantHeaders, UpdatePaymentForm } from '../schemas/billing.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [billing.ck](../../contracts/billing.ck)
*/
export const BillingRoutes: FastifyPluginAsync = async app => {

    /**
     * create a payment
     * from [billing.ck](../../contracts/billing.ck#L69)
    */
    app.post('/payments', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, PaymentInput);

        const service = request.container.get(PaymentService);
        const result: { body: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean; xExpiresAfter?: DateTime } } = await service.create(body);

        reply.status(200);
        reply.header('x-request-id', String(result.headers["xRequestId"]));
        reply.header('x-ratelimit-remaining', String(result.headers["xRatelimitRemaining"]));
        if (result.headers["xCacheHit"] !== undefined) reply.header('x-cache-hit', String(result.headers["xCacheHit"]));
        if (result.headers["xExpiresAfter"] !== undefined) reply.header('x-expires-after', String(result.headers["xExpiresAfter"]));
        reply.type('application/json');
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result.body);
    });

    /**
     * list payments
     * from [billing.ck](../../contracts/billing.ck#L89)
    */
    app.get('/payments', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const query = await parseAndValidate(
            request.query,
            z.strictObject({
                limit: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(20),
                cursor: z.string(),
                status: z.enum(["pending", "completed", "failed"]).optional(),
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
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * search payments with a filter model
     * from [billing.ck](../../contracts/billing.ck#L108)
    */
    app.get('/payments/search', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const query = await parseAndValidate(
            request.query,
            PaymentFilter.extend({
                ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, PaymentFilter.shape.ids),
            }).strict(),
        );

        const headers = await parseAndValidate(
            { ...request.headers, xCorrelationId: request.headers['xcorrelationid'] },
            TenantHeaders.strip(),
        );

        const service = request.container.get(PaymentService);
        const result: Payment[] = await service.search(query, headers);

        reply.status(200);
        reply.type('application/json');
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * create several payments at once
     * from [billing.ck](../../contracts/billing.ck#L120)
    */
    app.post('/payments/batch', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, z.array(PaymentInput));

        const service = request.container.get(PaymentService);
        const result: Payment[] = await service.createBatch(body);

        reply.status(200);
        reply.type('application/json');
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * fetch one payment
     * from [billing.ck](../../contracts/billing.ck#L137)
    */
    app.get('/payments/:paymentId', { preHandler: [requirePolicy()] }, async (request, reply) => {
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
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * update a payment with form data
     * from [billing.ck](../../contracts/billing.ck#L146)
    */
    app.post('/payments/:paymentId', { config: { body: ['application/x-www-form-urlencoded'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const { paymentId } = await parseAndValidate(
            request.params,
            z.strictObject({
                paymentId: z.uuid(),
            }),
        );

        const body = await parseAndValidate(request.body, UpdatePaymentForm);

        const service = request.container.get(PaymentService);
        await service.updateWithForm(paymentId, body);

        reply.status(204);
        return reply.send();
    });

    /**
     * delete a payment — declares only a documented error status
     * from [billing.ck](../../contracts/billing.ck#L157)
    */
    app.delete('/payments/:paymentId', { preHandler: [requirePolicy()] }, async (request, reply) => {
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
     * from [billing.ck](../../contracts/billing.ck#L171)
    */
    app.post('/payments/:paymentId/receipt', { config: { body: ['multipart/form-data'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const { paymentId } = await parseAndValidate(
            request.params,
            z.strictObject({
                paymentId: z.uuid(),
            }),
        );

        const multipartBody = request.body as MultipartBody;

        const service = request.container.get(PaymentService);
        const result: Payment = await service.uploadReceipt(paymentId, multipartBody);

        reply.status(200);
        reply.type('application/json');
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * look up a refund by its originating payment
     * from [billing.ck](../../contracts/billing.ck#L186)
     * @deprecated
    */
    app.get('/refunds/:paymentId', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const params = await parseAndValidate(request.params, PaymentRef.strict());

        const service = request.container.get(PaymentService);
        const result: Payment = await service.getRefund(params);

        reply.status(200);
        reply.type('application/json');
        return reply.serializer((payload: unknown) => JSON.stringify(payload, bigIntReplacer)).send(result);
    });

    /**
     * store a credential
     * from [billing.ck](../../contracts/billing.ck#L200)
    */
    app.post('/credentials', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, AdminCredentialInput);

        const service = request.container.get(PaymentService);
        const result: Credential = await service.createCredential(body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * open a session
     * from [billing.ck](../../contracts/billing.ck#L213)
    */
    app.post('/sessions', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, SessionInput);

        const service = request.container.get(PaymentService);
        const result: Session = await service.createSession(body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * search payments with snake_case filter and header models
     * from [billing.ck](../../contracts/billing.ck#L238)
    */
    app.get('/payments/by-date', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const query = await parseAndValidate(request.query, SnakeFilter.in.strict().pipe(SnakeFilter.out));

        const headers = await parseAndValidate(request.headers, SnakeHeaders.in.loose().pipe(SnakeHeaders.out));

        const service = request.container.get(PaymentService);
        await service.searchByDate(query, headers);

        reply.status(204);
        return reply.send();
    });

    /**
     * search payments with a snake_case filter extended inline
     * from [billing.ck](../../contracts/billing.ck#L268)
    */
    app.get('/payments/by-date/scoped', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const query = await parseAndValidate(
            request.query,
            SnakeFilter.in.extend({
                q: z.string(),
            }).strict().transform(({ from_date: _0, ...rest }) => ({
                ...rest,
                ...SnakeFilter.out.parse({ from_date: _0 }),
            })),
        );

        const headers = await parseAndValidate(
            { ...request.headers, xTrace: request.headers['xtrace'] },
            SnakeHeaders.in.extend({
                xTrace: z.string().optional(),
            }).strip().transform(({ tenant_id: _0, ...rest }) => ({
                ...rest,
                ...SnakeHeaders.out.parse({ tenant_id: _0 }),
            })),
        );

        const resultType = SnakeFilter.in.extend({
    q: z.string(),
}).transform(({ from_date: _0, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0 }),
}));
        const service = request.container.get(PaymentService);
        const result: z.infer<typeof resultType> = await service.searchScoped(query, headers);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * save a scoped search
     * from [billing.ck](../../contracts/billing.ck#L277)
    */
    app.post('/payments/by-date/scoped', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const query = await parseAndValidate(request.query, ScopedFilter.in.strict().pipe(ScopedFilter.out));

        const body = await parseAndValidate(request.body, PaymentScope.extend(SnakeFilter.in.shape).transform(({ from_date: _0, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0 }),
})));

        const service = request.container.get(PaymentService);
        const result: SavedSearch = await service.saveScopedSearch(body, query);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};