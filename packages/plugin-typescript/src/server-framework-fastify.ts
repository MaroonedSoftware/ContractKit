import type { ServerFramework } from './server-framework.js';

/** Module the Fastify flavour of ServerKit publishes its router and route middleware from. */
const FASTIFY_RUNTIME_MODULE = '@maroonedsoftware/fastify';

/**
 * Symbols importable from {@link FASTIFY_RUNTIME_MODULE}. Every one is a name the adapter itself
 * emits, so none can collide with a service class or router name derived from a contract.
 *
 * `requestMediaType` is here because Fastify has no accessor that strips the parameters off
 * `Content-Type`, and it is only referenced when an operation declares several request MIME types.
 */
const FASTIFY_RUNTIME_SYMBOLS = ['ServerKitRouter', 'bodyParserMiddleware', 'requirePolicy', 'requireSignature', 'requestMediaType'] as const;

/**
 * ServerKit on Fastify: `ServerKitRouter()` collects routes the way a Koa app reads and mounts them
 * as a Fastify plugin, handlers take `(request, reply)` where the request *is* the ServerKit
 * context, and a response is sent by returning `reply.send(...)` rather than by assignment.
 */
export const FASTIFY_SERVER_FRAMEWORK: ServerFramework = {
    name: 'fastify',

    imports(uses) {
        const symbols = FASTIFY_RUNTIME_SYMBOLS.filter(uses);
        return symbols.length > 0 ? [`import { ${symbols.join(', ')} } from '${FASTIFY_RUNTIME_MODULE}';`] : [];
    },

    routerDeclaration(routerName) {
        return `export const ${routerName} = ServerKitRouter();`;
    },

    pathParam(identifier) {
        return `:${identifier}`;
    },

    handlerLocals: ['request', 'reply'],

    routeOpen(routerName, method, path, middlewares) {
        const middlewareStr = middlewares.length > 0 ? `, ${middlewares.join(', ')},` : ',';
        return `${routerName}.${method}('${path}'${middlewareStr} async (request, reply) => {`;
    },

    routeClose() {
        return ['});'];
    },

    middleware: {
        policy(args) {
            return `requirePolicy(${args})`;
        },
        bodyParser(tokensExpr) {
            return `bodyParserMiddleware([${tokensExpr}])`;
        },
        signature(args) {
            return `requireSignature(${args})`;
        },
    },

    request: {
        params: 'request.params',
        query: 'request.query',
        headers: 'request.headers',
        // ServerKit parses lazily per route, so Fastify's own `request.body` is never populated.
        parsedBody: 'request.parsedBody',
        // A call, not a property: the raw header carries `; charset=utf-8`, which would match none of
        // the declared MIME literals the generated switch compares against.
        contentType: 'requestMediaType(request)',
    },

    resolveService(className) {
        return `request.container.get(${className})`;
    },

    response: {
        status(expr) {
            return `reply.status(${expr});`;
        },
        header(name, valueExpr) {
            return `reply.header('${name}', ${valueExpr});`;
        },
        type(expr) {
            return `reply.type(${expr});`;
        },
        send(bodyExpr) {
            // Unlike Koa, a bodyless response still needs a statement: a handler that neither returns
            // a body nor calls `send` leaves the request hanging.
            return bodyExpr === undefined ? ['return reply.send();'] : [`return reply.send(${bodyExpr});`];
        },
        caseEnd() {
            // Every status case has already returned, so a `break` here would be unreachable code.
            return [];
        },
    },

    mcpRouter({ path }) {
        return `import { type ServerKitRouterType, bodyParserMiddleware, requireSignature, requestHeader } from '${FASTIFY_RUNTIME_MODULE}';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** Mount the MCP endpoint onto a ServerKit router. Bind \`registerMcpTools\` to the \`McpToolHandlerMap\` token. */
export function mountMcp(router: ServerKitRouterType): void {
    router.post('${path}', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async (request, reply) => {
        const dispatcher = request.container.get(McpDispatcher);
        const context = createMcpRequestContext({ requestId: request.requestId, logger: request.logger });
        if (dispatcher.sessionMode === 'stateful') {
            // Fastify's equivalent of Koa's \`ctx.respond = false\`: the dispatcher writes the raw
            // response itself, and the request scope is disposed on the raw socket close instead.
            reply.hijack();
            await dispatcher.dispatchStateful(
                {
                    req: request.raw,
                    res: reply.raw,
                    body: request.parsedBody,
                    // \`requestHeader\` returns '' for an absent header; the session id is optional.
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
`;
    },
};
