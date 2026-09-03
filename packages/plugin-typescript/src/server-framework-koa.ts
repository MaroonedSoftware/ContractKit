import { classifyContentType } from '@contractkit/core';
import type { ServerFramework } from './server-framework.js';

/** Module the Koa flavour of ServerKit publishes its router and route middleware from. */
const KOA_RUNTIME_MODULE = '@maroonedsoftware/koa';

/**
 * Symbols importable from {@link KOA_RUNTIME_MODULE}. Every one is a name the adapter itself emits,
 * so none can collide with a service class or router name derived from a contract.
 */
const KOA_RUNTIME_SYMBOLS = ['ServerKitRouter', 'bodyParserMiddleware', 'requirePolicy', 'requireSignature'] as const;

/**
 * Map a request MIME type to the ServerKit body-parser token `bodyParserMiddleware` accepts. The
 * tokens are the keys of the parser map in `@maroonedsoftware/servercore`, so they are the same
 * whichever HTTP framework the router targets — only Koa still runs body parsing as a middleware
 * call, so only this adapter needs the mapping.
 */
function bodyParserToken(contentType: string): string {
    switch (classifyContentType(contentType)) {
        case 'urlencoded':
            return 'urlencoded';
        case 'multipart':
            return 'multipart';
        case 'text':
            return 'text';
        case 'binary':
            // There is no native binary token; fall back to text so the body is still readable as a
            // string. Services handling binary uploads should switch to multipart/form-data.
            return 'text';
        default:
            return 'json';
    }
}

/** Render `bodyParserMiddleware([...])`, deduping the MIME types down to their tokens. */
function bodyParserCall(contentTypes: readonly string[]): string {
    const tokens = Array.from(new Set(contentTypes.map(bodyParserToken)));
    return `bodyParserMiddleware([${tokens.map(t => `'${t}'`).join(', ')}])`;
}

/**
 * ServerKit on Koa: the router is a `@koa/router` instance, handlers take a single `ctx`, and a
 * response is written by assigning to `ctx.status` / `ctx.type` / `ctx.body` rather than returned.
 */
export const KOA_SERVER_FRAMEWORK: ServerFramework = {
    name: 'koa',

    imports(uses) {
        const symbols = KOA_RUNTIME_SYMBOLS.filter(uses);
        return symbols.length > 0 ? [`import { ${symbols.join(', ')} } from '${KOA_RUNTIME_MODULE}';`] : [];
    },

    routerName(baseName) {
        return `${baseName}Router`;
    },

    routerDeclaration(routerName) {
        return `export const ${routerName} = ServerKitRouter();`;
    },

    routerWrapsRoutes: false,

    routerClose() {
        return [];
    },

    pathParam(identifier) {
        return `:${identifier}`;
    },

    handlerLocals: ['ctx'],

    routeOpen(routerName, method, path, guards) {
        const middlewares: string[] = [];
        if (guards.policy) middlewares.push(guards.policy);
        if (guards.bodyContentTypes && guards.bodyContentTypes.length > 0) middlewares.push(bodyParserCall(guards.bodyContentTypes));
        if (guards.signature) middlewares.push(guards.signature);
        const middlewareStr = middlewares.length > 0 ? `, ${middlewares.join(', ')},` : ',';
        return `${routerName}.${method}('${path}'${middlewareStr} async ctx => {`;
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
        params: 'ctx.params',
        query: 'ctx.query',
        headers: 'ctx.headers',
        // Not `ctx.request.body`: the ServerKit body parser drains the stream and writes its result
        // here, and in Koa `ctx.body` is the *response* body.
        parsedBody: 'ctx.parsedBody',
        // Koa strips the parameters off `Content-Type` for this accessor already.
        contentType: 'ctx.request.type',
    },

    resolveService(className) {
        return `ctx.container.get(${className})`;
    },

    response: {
        status(expr) {
            return `ctx.status = ${expr};`;
        },
        header(name, valueExpr) {
            return `ctx.set('${name}', ${valueExpr});`;
        },
        type(expr) {
            return `ctx.type = ${expr};`;
        },
        send(bodyExpr) {
            // A bodyless response needs no statement at all: Koa sends whatever `ctx.status` and the
            // headers say once the handler resolves.
            return bodyExpr === undefined ? [] : [`ctx.body = ${bodyExpr};`];
        },
        caseEnd() {
            return ['break;'];
        },
    },

    mcpRouter({ path }) {
        return `import { ServerKitRouter, bodyParserMiddleware, requireSignature } from '${KOA_RUNTIME_MODULE}';
import { McpDispatcher, createMcpRequestContext, MCP_AUTH_POLICY } from '@maroonedsoftware/mcp';

/** Mount the MCP endpoint onto a ServerKit router. Bind \`registerMcpTools\` to the \`McpToolHandlerMap\` token. */
export function mountMcp(router: ReturnType<typeof ServerKitRouter>): void {
    router.post('${path}', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async (ctx) => {
        const dispatcher = ctx.container.get(McpDispatcher);
        const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger });
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
`;
    },
};
