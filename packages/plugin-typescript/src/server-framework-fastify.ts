import type { RouteMiddleware, ServerFramework } from './server-framework.js';

/** Module the Fastify flavour of ServerKit publishes its route guards from. */
const FASTIFY_RUNTIME_MODULE = '@maroonedsoftware/fastify';

/**
 * Symbols importable from {@link FASTIFY_RUNTIME_MODULE}. Every one is a name the adapter itself
 * emits, so none can collide with a service class or router name derived from a contract.
 *
 * Just the two route guards, unlike Koa's list: on ServerKit's native-Fastify API (0.3+) body
 * parsing is no longer a runtime call the generated code makes — it is `config.body`, declared
 * inline by {@link routeOptionsExpr} — and `ServerKitRouter` and `requestMediaType` are gone from
 * the package's public surface. Routes are ordinary Fastify plugins, and content-type stripping is
 * inlined in {@link FASTIFY_SERVER_FRAMEWORK.request.contentType} instead.
 */
const FASTIFY_RUNTIME_SYMBOLS = ['requirePolicy', 'requireSignature'] as const;

/**
 * Render a route's second argument — `{ config, preHandler }` — omitting the whole object when
 * neither a body allow-list nor a guard applies, and trailing with the separator the call needs
 * before its handler.
 */
function routeOptionsExpr(guards: RouteMiddleware): string {
    const parts: string[] = [];
    if (guards.bodyContentTypes && guards.bodyContentTypes.length > 0) {
        parts.push(`config: { body: [${guards.bodyContentTypes.map(t => `'${t}'`).join(', ')}] }`);
    }
    const preHandlers = [guards.policy, guards.signature].filter((g): g is string => g !== undefined);
    if (preHandlers.length > 0) {
        parts.push(`preHandler: [${preHandlers.join(', ')}]`);
    }
    return parts.length > 0 ? `{ ${parts.join(', ')} }, ` : '';
}

/**
 * ServerKit on Fastify: a route file is a `FastifyPluginAsync` registered through
 * `builder.setupRoutes`, handlers take `(request, reply)` where the request *is* the ServerKit
 * context, and a response is sent by returning `reply.send(...)` rather than by assignment. Guards
 * go in a route's `preHandler`; the body allow-list is declared through `config.body` rather than
 * run as a middleware call, since Fastify's own content-type parser reads it.
 */
export const FASTIFY_SERVER_FRAMEWORK: ServerFramework = {
    name: 'fastify',

    imports(uses) {
        const lines = [`import type { FastifyPluginAsync } from 'fastify';`];
        const symbols = FASTIFY_RUNTIME_SYMBOLS.filter(uses);
        if (symbols.length > 0) lines.push(`import { ${symbols.join(', ')} } from '${FASTIFY_RUNTIME_MODULE}';`);
        return lines;
    },

    routerName(baseName) {
        return `${baseName}Routes`;
    },

    routerDeclaration(routerName) {
        return `export const ${routerName}: FastifyPluginAsync = async app => {`;
    },

    routerWrapsRoutes: true,

    routerClose() {
        return ['};'];
    },

    pathParam(identifier) {
        return `:${identifier}`;
    },

    handlerLocals: ['request', 'reply'],

    routeOpen(_routerName, method, path, guards) {
        return `app.${method}('${path}', ${routeOptionsExpr(guards)}async (request, reply) => {`;
    },

    routeClose() {
        return ['});'];
    },

    middleware: {
        policy(args) {
            return `requirePolicy(${args})`;
        },
        signature(args) {
            return `requireSignature(${args})`;
        },
    },

    request: {
        params: 'request.params',
        query: 'request.query',
        headers: 'request.headers',
        // The parsed value lands on Fastify's own `request.body`: `bodyParserPlugin` replaces
        // Fastify's content-type parsers outright, rather than adding a side channel the way the
        // old `bodyParserMiddleware` + `request.parsedBody` pair did.
        parsedBody: 'request.body',
        // Inlined rather than a runtime call: `requestMediaType` existed only to re-create Koa's
        // request API and isn't part of the package's public surface any more. The raw header
        // carries `; charset=…`, which would match none of the declared MIME literals, so this
        // still strips it before the generated `switch` compares against them.
        contentType: `(request.headers['content-type'] ?? '').split(';', 1)[0]!.trim()`,
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
        return `import type { FastifyPluginAsync } from 'fastify';
import { requireSignature } from '${FASTIFY_RUNTIME_MODULE}';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** First value of a possibly-repeated header, or undefined when absent. */
function firstHeader(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/**
 * Mount the MCP endpoint as a ServerKit route plugin. Register with
 * \`builder.setupRoutes([mountMcp])\` (or a \`{ plugin: mountMcp, prefix }\` mount), and bind \`registerMcpTools\` to the \`McpToolHandlerMap\` token.
 */
export const mountMcp: FastifyPluginAsync = async app => {
    app.post(
        '${path}',
        { config: { body: ['application/json'] }, preHandler: [requireSignature('mcp', { policy: MCP_AUTH_POLICY })] },
        async (request, reply) => {
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
        },
    );
};
`;
    },
};
