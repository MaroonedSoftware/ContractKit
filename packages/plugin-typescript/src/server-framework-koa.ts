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

    mcpRouter({ path, guards }) {
        // The route line goes through `routeOpen`, the same renderer every operation route uses, so
        // the mount cannot spell a guard differently from the routes beside it.
        const body = `/** Mount the MCP endpoint onto a ServerKit router. Bind \`registerMcpTools\` to the \`McpToolHandlerMap\` token. */
export function mountMcp(router: ReturnType<typeof ServerKitRouter>): void {
    ${KOA_SERVER_FRAMEWORK.routeOpen('router', 'post', path, guards)}
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
    ${KOA_SERVER_FRAMEWORK.routeClose().join('\n    ')}
}
`;

        // Probed the way `generateOp` probes an operation file, so a guard the mount does not use
        // brings no import with it.
        const uses = (symbol: string) => new RegExp(`\\b${symbol}\\b`).test(body);
        const mcpSymbols = ['McpDispatcher', 'createMcpRequestContext', ...(uses('MCP_AUTH_POLICY') ? ['MCP_AUTH_POLICY'] : [])];
        const imports = [...KOA_SERVER_FRAMEWORK.imports(uses), `import { ${mcpSymbols.join(', ')} } from '@maroonedsoftware/mcp';`];

        return `${imports.join('\n')}\n\n${body}`;
    },
};
