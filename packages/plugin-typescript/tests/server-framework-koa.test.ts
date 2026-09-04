import { describe, it, expect } from 'vitest';
import { KOA_SERVER_FRAMEWORK as koa } from '../src/server-framework-koa.js';

const mcpGuards = {
    bodyContentTypes: ['application/json'],
    signature: "requireSignature('mcp', { policy: MCP_AUTH_POLICY })",
};

/**
 * The Koa adapter is the reference implementation: every string here is one the generator emitted
 * inline before the seam existed. Pinning them individually means a change to any one of them shows
 * up as a failure here, naming the piece, rather than only as a snapshot diff two packages away.
 */
describe('KOA_SERVER_FRAMEWORK', () => {
    it('is named koa', () => {
        expect(koa.name).toBe('koa');
    });

    describe('imports', () => {
        it('emits one line naming every symbol the body uses', () => {
            expect(koa.imports(() => true)).toEqual([
                "import { ServerKitRouter, bodyParserMiddleware, requirePolicy, requireSignature } from '@maroonedsoftware/koa';",
            ]);
        });

        it('narrows to the symbols the body actually references', () => {
            expect(koa.imports(s => s === 'requirePolicy')).toEqual(["import { requirePolicy } from '@maroonedsoftware/koa';"]);
        });

        it('emits nothing when the body references none of them', () => {
            expect(koa.imports(() => false)).toEqual([]);
        });
    });

    it('names the router with a Router suffix', () => {
        expect(koa.routerName('Billing')).toBe('BillingRouter');
    });

    it('declares the router', () => {
        expect(koa.routerDeclaration('UsersRouter')).toBe('export const UsersRouter = ServerKitRouter();');
    });

    it('does not wrap its routes in a block — they are top-level statements against the router', () => {
        expect(koa.routerWrapsRoutes).toBe(false);
        expect(koa.routerClose()).toEqual([]);
    });

    it('renders a path parameter with a colon', () => {
        expect(koa.pathParam('userId')).toBe(':userId');
    });

    describe('routeOpen', () => {
        it('omits the middleware list when there are no guards', () => {
            expect(koa.routeOpen('UsersRouter', 'get', '/users', {})).toBe("UsersRouter.get('/users', async ctx => {");
        });

        it('places policy and signature guards between the path and the handler', () => {
            expect(koa.routeOpen('UsersRouter', 'post', '/users', { policy: 'requirePolicy()', signature: "requireSignature('slack')" })).toBe(
                "UsersRouter.post('/users', requirePolicy(), requireSignature('slack'), async ctx => {",
            );
        });

        it('renders the body content types as a bodyParserMiddleware call, between policy and signature', () => {
            expect(
                koa.routeOpen('UsersRouter', 'post', '/users', {
                    policy: 'requirePolicy()',
                    bodyContentTypes: ['application/json'],
                    signature: "requireSignature('slack')",
                }),
            ).toBe("UsersRouter.post('/users', requirePolicy(), bodyParserMiddleware(['json']), requireSignature('slack'), async ctx => {");
        });

        it('dedupes several MIME types down to their shared parser token', () => {
            expect(koa.routeOpen('UsersRouter', 'post', '/users', { bodyContentTypes: ['application/json', 'application/vnd.api+json'] })).toBe(
                "UsersRouter.post('/users', bodyParserMiddleware(['json']), async ctx => {",
            );
        });

        it('keeps distinct tokens for MIME types that parse differently', () => {
            expect(koa.routeOpen('UsersRouter', 'post', '/users', { bodyContentTypes: ['application/json', 'multipart/form-data'] })).toBe(
                "UsersRouter.post('/users', bodyParserMiddleware(['json', 'multipart']), async ctx => {",
            );
        });
    });

    it('closes a route', () => {
        expect(koa.routeClose()).toEqual(['});']);
    });

    it('renders the route guard factories', () => {
        expect(koa.middleware.policy('')).toBe('requirePolicy()');
        expect(koa.middleware.policy("{ policy: 'admin' }")).toBe("requirePolicy({ policy: 'admin' })");
        expect(koa.middleware.signature("'slack'")).toBe("requireSignature('slack')");
    });

    it('reads the request off the context', () => {
        expect(koa.request).toEqual({
            params: 'ctx.params',
            query: 'ctx.query',
            headers: 'ctx.headers',
            parsedBody: 'ctx.parsedBody',
            contentType: 'ctx.request.type',
        });
    });

    it('resolves a service from the request container', () => {
        expect(koa.resolveService('PaymentService')).toBe('ctx.container.get(PaymentService)');
    });

    describe('response', () => {
        it('assigns the status', () => {
            expect(koa.response.status('200')).toBe('ctx.status = 200;');
            expect(koa.response.status('result.status')).toBe('ctx.status = result.status;');
        });

        it('sets a header as a single statement, so the optional guard can wrap it', () => {
            expect(koa.response.header('x-request-id', 'String(result.headers["xRequestId"])')).toBe(
                'ctx.set(\'x-request-id\', String(result.headers["xRequestId"]));',
            );
        });

        it('assigns the content type', () => {
            expect(koa.response.type("'application/json'")).toBe("ctx.type = 'application/json';");
            expect(koa.response.type('result.contentType')).toBe('ctx.type = result.contentType;');
        });

        it('assigns the body, and writes nothing at all when there is none', () => {
            expect(koa.response.send('result')).toEqual(['ctx.body = result;']);
            // Koa ends the response on its own once the handler resolves, so a 204 needs no statement.
            expect(koa.response.send(undefined)).toEqual([]);
        });

        it('closes a status case with a break', () => {
            expect(koa.response.caseEnd()).toEqual(['break;']);
        });
    });

    describe('mcpRouter', () => {
        it('mounts the dispatcher at the given path', () => {
            const out = koa.mcpRouter({ path: '/tools', guards: mcpGuards });
            expect(out).toContain("router.post('/tools',");
            expect(out).toContain("import { ServerKitRouter, bodyParserMiddleware, requireSignature } from '@maroonedsoftware/koa';");
            expect(out).toContain('const dispatcher = ctx.container.get(McpDispatcher);');
        });

        it('hands the dispatcher the session the authentication stack resolved', () => {
            // The stack deletes the Authorization header once it has resolved it, so the session is
            // the only identity a tool handler can still read.
            const out = koa.mcpRouter({ path: '/mcp', guards: mcpGuards });
            expect(out).toContain(
                'const context = createMcpRequestContext({ requestId: ctx.requestId, logger: ctx.logger, authenticationSession: ctx.authenticationSession });',
            );
        });

        it('renders the guards it is handed through routeOpen, so the mount reads like any other route', () => {
            const out = koa.mcpRouter({ path: '/mcp', guards: mcpGuards });
            expect(out).toContain(
                "router.post('/mcp', bodyParserMiddleware(['json']), requireSignature('mcp', { policy: MCP_AUTH_POLICY }), async ctx => {",
            );
        });

        it('imports only the guards the mount actually uses', () => {
            const out = koa.mcpRouter({ path: '/mcp', guards: { policy: 'requirePolicy({ policy: false })' } });
            expect(out).toContain("import { ServerKitRouter, requirePolicy } from '@maroonedsoftware/koa';");
            expect(out).toContain("import { McpDispatcher, createMcpRequestContext } from '@maroonedsoftware/mcp';");
            expect(out).not.toContain('requireSignature');
            expect(out).not.toContain('MCP_AUTH_POLICY');
        });

        it('escapes the backticks in its own doc comment rather than closing the template', () => {
            expect(koa.mcpRouter({ path: '/mcp', guards: mcpGuards })).toContain('Bind `registerMcpTools` to the `McpToolHandlerMap` token.');
        });
    });
});
