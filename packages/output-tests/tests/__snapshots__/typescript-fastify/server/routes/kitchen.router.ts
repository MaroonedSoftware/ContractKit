import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import { requirePolicy } from '@maroonedsoftware/fastify';
import { KitchenService } from '#src/services/kitchen.service.js';
import { Folder, Instrument, LedgerInput, LedgerOutput, Shared, SharedInput, Stamped, StampedOutput, Token, TokenOutput } from '../schemas/kitchen.schema.js';
import { DateTime } from 'luxon';
import { parseAndValidate } from '@maroonedsoftware/zod';

/**
 * generated from [kitchen.ck](../../contracts/kitchen.ck)
*/
export const KitchenRoutes: FastifyPluginAsync = async app => {

    /**
     * several statuses, and two content types on one of them
     * from [kitchen.ck](../../contracts/kitchen.ck#L108)
    */
    app.get('/folders/:folderId', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const { folderId } = await parseAndValidate(
            request.params,
            z.strictObject({
                folderId: z.uuid(),
            }),
        );

        const query = await parseAndValidate(
            request.query,
            z.strictObject({
                depth: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).default(1),
                tags: z.preprocess((v) => typeof v === 'string' ? v.split(',') : v, z.array(z.string())).optional(),
            }),
        );

        const headers = await parseAndValidate(
            request.headers,
            z.object({
                'x-trace': z.string(),
                'x-opt': z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional(),
            }),
        );

        const service = request.container.get(KitchenService);
        const result:
            | { status: 200; contentType: 'application/json'; body: Folder; headers: { xCount: number; xWhen?: DateTime } }
            | { status: 200; contentType: 'text/plain'; body: string; headers: { xCount: number; xWhen?: DateTime } }
            | { status: 204 }
            | { status: 404; contentType: 'application/json'; body: Shared }
            = await service.getFolder(folderId, query, headers);

        reply.status(result.status);
        switch (result.status) {
            case 200:
                reply.header('x-count', String(result.headers["xCount"]));
                if (result.headers["xWhen"] !== undefined) reply.header('x-when', String(result.headers["xWhen"]));
                reply.type(result.contentType);
                return reply.send(result.body);
            case 204:
                return reply.send();
            case 404:
                reply.type(result.contentType);
                return reply.send(result.body);
        }
    });

    /**
     * a method name that is a keyword in the target languages
     * from [kitchen.ck](../../contracts/kitchen.ck#L135)
    */
    app.put('/folders/:folderId', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const { folderId } = await parseAndValidate(
            request.params,
            z.strictObject({
                folderId: z.uuid(),
            }),
        );

        const body = await parseAndValidate(request.body, SharedInput);

        const service = request.container.get(KitchenService);
        const result: Instrument = await service.replace(folderId, body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * from [kitchen.ck](../../contracts/kitchen.ck#L150)
    */
    app.post('/ledgers', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, LedgerInput);

        const service = request.container.get(KitchenService);
        const result: LedgerOutput = await service.postLedger(body);

        reply.status(201);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * from [kitchen.ck](../../contracts/kitchen.ck#L165)
    */
    app.post('/stamps', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, Stamped);

        const service = request.container.get(KitchenService);
        const result: StampedOutput = await service.stamp(body);

        reply.status(201);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * from [kitchen.ck](../../contracts/kitchen.ck#L180)
    */
    app.post('/tokens', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, Token);

        const service = request.container.get(KitchenService);
        const result: TokenOutput = await service.mint(body);

        reply.status(201);
        reply.type('application/json');
        return reply.send(result);
    });

    /**
     * from [kitchen.ck](../../contracts/kitchen.ck#L194)
    */
    app.get('/tokens', { preHandler: [requirePolicy()] }, async (request, reply) => {
        const service = request.container.get(KitchenService);
        const result: TokenOutput[] = await service.listTokens();

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });

};