import type { FastifyPluginAsync } from 'fastify';
import { requireSignature } from '@maroonedsoftware/fastify';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** First value of a possibly-repeated header, or undefined when absent. */
function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Mount the MCP endpoint as a ServerKit route plugin. Register with
 * `builder.setupRoutes([mountMcp])` (or a `{ plugin: mountMcp, prefix }` mount), and bind `registerMcpTools` to the `McpToolHandlerMap` token.
 */
export const mountMcp: FastifyPluginAsync = async app => {
    app.post('/mcp', { config: { body: ['application/json'] }, preHandler: [requireSignature('mcp', { policy: MCP_AUTH_POLICY })] }, async (request, reply) => {
        const dispatcher = request.container.get(McpDispatcher);
        const context = createMcpRequestContext({ requestId: request.requestId, logger: request.logger });
        if (dispatcher.sessionMode === 'stateful') {
            // Fastify's equivalent of Koa's `ctx.respond = false`: the dispatcher writes the raw
            // response itself, and the request scope is disposed on the raw socket close instead.
            reply.hijack();
            await dispatcher.dispatchStateful(
                {
                    req: request.raw,
                    res: reply.raw,
                    body: request.body,
                    sessionId: firstHeader(request.headers['mcp-session-id']),
                },
                context,
            );
            return;
        }
        const response = await dispatcher.dispatch(JSON.parse(String(request.rawBody)), context);
        if (response) return reply.send(response);
        reply.status(202); // a notification — nothing to return
        return reply.send();
    });
};
