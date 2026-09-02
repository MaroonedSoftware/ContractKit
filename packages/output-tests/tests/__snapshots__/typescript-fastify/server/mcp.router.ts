import { type ServerKitRouterType, bodyParserMiddleware, requireSignature, requestHeader } from '@maroonedsoftware/fastify';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** Mount the MCP endpoint onto a ServerKit router. Bind `registerMcpTools` to the `McpToolHandlerMap` token. */
export function mountMcp(router: ServerKitRouterType): void {
    router.post('/mcp', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async (request, reply) => {
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
                    body: request.parsedBody,
                    // `requestHeader` returns '' for an absent header; the session id is optional.
                    sessionId: requestHeader(request, 'mcp-session-id') || undefined,
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
}
