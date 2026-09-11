import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware, requirePolicy } from '@maroonedsoftware/koa';
import { KitchenService } from '#src/services/kitchen.service.js';
import { Folder, Instrument, Shared, SharedInput, Token, TokenOutput } from '../schemas/kitchen.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';

/**
 * generated from [kitchen.ck](../../contracts/kitchen.ck)
*/
export const KitchenRouter = ServerKitRouter();

/**
 * several statuses, and two content types on one of them
 * from [kitchen.ck](../../contracts/kitchen.ck#L91)
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
        | { status: 200; contentType: 'application/json'; body: Folder; headers: { xCount: number; xWhen?: DateTime } }
        | { status: 200; contentType: 'text/plain'; body: string; headers: { xCount: number; xWhen?: DateTime } }
        | { status: 204 }
        | { status: 404; contentType: 'application/json'; body: Shared }
        = await service.getFolder(folderId, query, headers);

    ctx.status = result.status;
    switch (result.status) {
        case 200:
            ctx.set('x-count', String(result.headers["xCount"]));
            if (result.headers["xWhen"] !== undefined) ctx.set('x-when', String(result.headers["xWhen"]));
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
 * from [kitchen.ck](../../contracts/kitchen.ck#L118)
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
 * from [kitchen.ck](../../contracts/kitchen.ck#L133)
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
 * from [kitchen.ck](../../contracts/kitchen.ck#L147)
*/
KitchenRouter.get('/tokens', requirePolicy(), async ctx => {
    const service = ctx.container.get(KitchenService);
    const result: TokenOutput[] = await service.listTokens();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;
});
