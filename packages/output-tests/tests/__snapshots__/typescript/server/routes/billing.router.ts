import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { PaymentService } from '#src/services/payment.service.js';
import { AdminCredentialInput, Credential, Payment, PaymentFilter, PaymentInput, PaymentRef, PaymentScope, SavedSearch, ScopedFilter, Session, SessionInput, SnakeFilter, SnakeHeaders, TenantHeaders, UpdatePaymentForm } from '../schemas/billing.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';
import { MultipartBody } from '@maroonedsoftware/multipart';

/**
 * generated from [billing.ck](../../contracts/billing.ck)
*/
export const BillingRouter = ServerKitRouter();

/**
 * create a payment
 * from [billing.ck](../../contracts/billing.ck#L69)
*/
BillingRouter.post('/payments', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, PaymentInput);

    const service = ctx.container.get(PaymentService);
    const result: { body: Payment; headers: { xRequestId: string; xRatelimitRemaining: number; xCacheHit?: boolean; xExpiresAfter?: DateTime } } = await service.create(body);

    ctx.status = 200;
    ctx.set('x-request-id', String(result.headers["xRequestId"]));
    ctx.set('x-ratelimit-remaining', String(result.headers["xRatelimitRemaining"]));
    if (result.headers["xCacheHit"] !== undefined) ctx.set('x-cache-hit', String(result.headers["xCacheHit"]));
    if (result.headers["xExpiresAfter"] !== undefined) ctx.set('x-expires-after', String(result.headers["xExpiresAfter"]));
    ctx.type = 'application/json';
    ctx.body = JSON.stringify(result.body, bigIntReplacer);
});

/**
 * list payments
 * from [billing.ck](../../contracts/billing.ck#L89)
*/
BillingRouter.get('/payments', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            limit: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(20),
            cursor: z.string(),
            status: z.enum(["pending", "completed", "failed"]).optional(),
        }),
    );

    const headers = await parseAndValidate(
        ctx.headers,
        z.object({
            'api-key': z.string().optional(),
            'x-tenant': z.string(),
        }),
    );

    const service = ctx.container.get(PaymentService);
    const result: Payment[] = await service.list(query, headers);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * search payments with a filter model
 * from [billing.ck](../../contracts/billing.ck#L108)
*/
BillingRouter.get('/payments/search', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        PaymentFilter.extend({
            ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, PaymentFilter.shape.ids),
        }).strict(),
    );

    const headers = await parseAndValidate(
        { ...ctx.headers, xCorrelationId: ctx.headers['xcorrelationid'] },
        TenantHeaders.strip(),
    );

    const service = ctx.container.get(PaymentService);
    const result: Payment[] = await service.search(query, headers);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * create several payments at once
 * from [billing.ck](../../contracts/billing.ck#L120)
*/
BillingRouter.post('/payments/batch', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, z.array(PaymentInput));

    const service = ctx.container.get(PaymentService);
    const result: Payment[] = await service.createBatch(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * fetch one payment
 * from [billing.ck](../../contracts/billing.ck#L137)
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
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * update a payment with form data
 * from [billing.ck](../../contracts/billing.ck#L146)
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
 * from [billing.ck](../../contracts/billing.ck#L157)
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

    ctx.status = 204;
});

/**
 * upload a receipt image
 * from [billing.ck](../../contracts/billing.ck#L171)
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
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * look up a refund by its originating payment
 * from [billing.ck](../../contracts/billing.ck#L186)
 * @deprecated
*/
BillingRouter.get('/refunds/:paymentId', requirePolicy(), async ctx => {
    const params = await parseAndValidate(ctx.params, PaymentRef.strict());

    const service = ctx.container.get(PaymentService);
    const result: Payment = await service.getRefund(params);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = JSON.stringify(result, bigIntReplacer);
});

/**
 * store a credential
 * from [billing.ck](../../contracts/billing.ck#L200)
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
 * from [billing.ck](../../contracts/billing.ck#L213)
*/
BillingRouter.post('/sessions', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, SessionInput);

    const service = ctx.container.get(PaymentService);
    const result: Session = await service.createSession(body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * search payments with snake_case filter and header models
 * from [billing.ck](../../contracts/billing.ck#L240)
*/
BillingRouter.get('/payments/by-date', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        SnakeFilter.in.extend({
            tag_ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, SnakeFilter.in.shape.tag_ids),
        }).strict().pipe(SnakeFilter.out),
    );

    const headers = await parseAndValidate(ctx.headers, SnakeHeaders.in.loose().pipe(SnakeHeaders.out));

    const service = ctx.container.get(PaymentService);
    await service.searchByDate(query, headers);

    ctx.status = 204;
});

/**
 * search payments with a snake_case filter extended inline
 * from [billing.ck](../../contracts/billing.ck#L270)
*/
BillingRouter.get('/payments/by-date/scoped', requirePolicy(), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        SnakeFilter.in.extend({
            q: z.string(),
        }).extend({
            tag_ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, SnakeFilter.in.shape.tag_ids),
        }).strict().transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
            ...rest,
            ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
        })),
    );

    const headers = await parseAndValidate(
        { ...ctx.headers, xTrace: ctx.headers['xtrace'] },
        SnakeHeaders.in.extend({
            xTrace: z.string().optional(),
        }).strip().transform(({ tenant_id: _0, ...rest }) => ({
            ...rest,
            ...SnakeHeaders.out.parse({ tenant_id: _0 }),
        })),
    );

    const resultType = SnakeFilter.in.extend({
    q: z.string(),
}).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
}));
    const service = ctx.container.get(PaymentService);
    const result: z.infer<typeof resultType> = await service.searchScoped(query, headers);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * save a scoped search
 * from [billing.ck](../../contracts/billing.ck#L279)
*/
BillingRouter.post('/payments/by-date/scoped', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const query = await parseAndValidate(
        ctx.query,
        ScopedFilter.in.extend({
            tag_ids: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, ScopedFilter.in.shape.tag_ids),
        }).strict().pipe(ScopedFilter.out),
    );

    const body = await parseAndValidate(ctx.parsedBody, PaymentScope.extend(SnakeFilter.in.shape).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
})));

    const service = ctx.container.get(PaymentService);
    const result: SavedSearch = await service.saveScopedSearch(body, query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
