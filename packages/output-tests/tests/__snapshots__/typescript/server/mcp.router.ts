import { ServerKitRouter, bodyParserMiddleware, requireSignature } from '@maroonedsoftware/koa';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** Mount the MCP endpoint onto a ServerKit router. Bind `registerMcpTools` to the `McpToolHandlerMap` token. */
export function mountMcp(router: ReturnType<typeof ServerKitRouter>): void {
    router.post('/mcp', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async ctx => {
        const dispatcher = ctx.container.get(McpDispatcher);
        const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession });
        if (dispatcher.sessionMode === 'stateful') {
            ctx.respond = false;
            await dispatcher.dispatchStateful(
                { req: ctx.req, res: ctx.res, body: ctx.parsedBody, sessionId: ctx.get('mcp-session-id') },
                context,
            );
        } else {
            const response = await dispatcher.dispatch(JSON.parse(String(ctx.rawBody)), context);
            if (response) ctx.body = response;
            else ctx.status = 202; // a notification — nothing to return
        }
    });
}
