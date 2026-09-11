import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { KitchenService } from '#src/services/kitchen.service.js';
import { Folder, Instrument, LedgerInput, LedgerOutput, Shared, SharedInput, Stamped, StampedOutput, Token, TokenOutput } from '../schemas/kitchen.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';

/**
 * generated from [kitchen.ck](../../contracts/kitchen.ck)
*/
export const KitchenRouter = ServerKitRouter();

/**
 * several statuses, and two content types on one of them
 * from [kitchen.ck](../../contracts/kitchen.ck#L109)
*/
KitchenRouter.get('/folders/:folderId', requirePolicy(), async ctx => {
    const { folderId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            folderId: z.uuid(),
        }),
    );

    const query = await parseAndValidate(
        ctx.query,
        z.strictObject({
            depth: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(1),
            tags: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, z.array(z.string())).optional(),
        }),
    );

    const headers = await parseAndValidate(
        ctx.headers,
        z.object({
            'x-trace': z.string(),
            'x-opt': z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
        }),
    );

    const service = ctx.container.get(KitchenService);
    const result:
        | { status: 200; contentType: 'application/json'; body: Folder; headers: { xCount: number; xWhen?: DateTime; xSeq?: bigint } }
        | { status: 200; contentType: 'text/plain'; body: string; headers: { xCount: number; xWhen?: DateTime; xSeq?: bigint } }
        | { status: 204 }
        | { status: 404; contentType: 'application/json'; body: Shared }
        = await service.getFolder(folderId, query, headers);

    ctx.status = result.status;
    switch (result.status) {
        case 200:
            ctx.set('x-count', String(result.headers["xCount"]));
            if (result.headers["xWhen"] !== undefined) ctx.set('x-when', String(result.headers["xWhen"]));
            if (result.headers["xSeq"] !== undefined) ctx.set('x-seq', String(result.headers["xSeq"]));
            ctx.type = result.contentType;
            if (result.contentType === 'application/json') {
                ctx.body = JSON.stringify(result.body, bigIntReplacer);
            } else {
                ctx.body = result.body;
            }
            break;
        case 204:
            break;
        case 404:
            ctx.type = result.contentType;
            ctx.body = result.body;
            break;
    }
});

/**
 * a method name that is a keyword in the target languages
 * from [kitchen.ck](../../contracts/kitchen.ck#L137)
*/
KitchenRouter.put('/folders/:folderId', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const { folderId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            folderId: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.parsedBody, SharedInput);

    const service = ctx.container.get(KitchenService);
    const result: Instrument = await service.replace(folderId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [kitchen.ck](../../contracts/kitchen.ck#L152)
*/
KitchenRouter.post('/ledgers', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, LedgerInput);

    const service = ctx.container.get(KitchenService);
    const result: LedgerOutput = await service.postLedger(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [kitchen.ck](../../contracts/kitchen.ck#L167)
*/
KitchenRouter.post('/stamps', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, Stamped);

    const service = ctx.container.get(KitchenService);
    const result: StampedOutput = await service.stamp(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [kitchen.ck](../../contracts/kitchen.ck#L182)
*/
KitchenRouter.post('/tokens', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {
    const body = await parseAndValidate(ctx.parsedBody, Token);

    const service = ctx.container.get(KitchenService);
    const result: TokenOutput = await service.mint(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * from [kitchen.ck](../../contracts/kitchen.ck#L196)
*/
KitchenRouter.get('/tokens', requirePolicy(), async ctx => {
    const service = ctx.container.get(KitchenService);
    const result: TokenOutput[] = await service.listTokens();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});

/**
 * one status with two content types and response headers, so the headers are read before the mime dispatch
 * from [kitchen.ck](../../contracts/kitchen.ck#L212)
*/
KitchenRouter.get('/folders/:folderId/export', requirePolicy(), async ctx => {
    const { folderId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            folderId: z.uuid(),
        }),
    );

    const service = ctx.container.get(KitchenService);
    const result: { contentType: 'application/json'; body: Folder; headers: { xExportId: string; xRows?: number } } | { contentType: 'text/csv'; body: string; headers: { xExportId: string; xRows?: number } } = await service.exportFolder(folderId);

    ctx.status = 200;
    ctx.set('x-export-id', String(result.headers["xExportId"]));
    if (result.headers["xRows"] !== undefined) ctx.set('x-rows', String(result.headers["xRows"]));
    ctx.type = result.contentType;
    if (result.contentType === 'application/json') {
        ctx.body = JSON.stringify(result.body, bigIntReplacer);
    } else {
        ctx.body = result.body;
    }
});
