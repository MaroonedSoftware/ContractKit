import { describe, it, expect } from 'vitest';
import { KOA_SERVER_FRAMEWORK as koa } from '../src/server-framework-koa.js';

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

    it('declares the router', () => {
        expect(koa.routerDeclaration('UsersRouter')).toBe('export const UsersRouter = ServerKitRouter();');
    });

    it('renders a path parameter with a colon', () => {
        expect(koa.pathParam('userId')).toBe(':userId');
    });

    describe('routeOpen', () => {
        it('omits the middleware list when there is none', () => {
            expect(koa.routeOpen('UsersRouter', 'get', '/users', [])).toBe("UsersRouter.get('/users', async ctx => {");
        });

        it('places the middleware between the path and the handler', () => {
            expect(koa.routeOpen('UsersRouter', 'post', '/users', ['requirePolicy()', "bodyParserMiddleware(['json'])"])).toBe(
                "UsersRouter.post('/users', requirePolicy(), bodyParserMiddleware(['json']), async ctx => {",
            );
        });
    });

    it('closes a route', () => {
        expect(koa.routeClose()).toEqual(['});']);
    });

    it('renders the route middleware factories', () => {
        expect(koa.middleware.policy('')).toBe('requirePolicy()');
        expect(koa.middleware.policy("{ policy: 'admin' }")).toBe("requirePolicy({ policy: 'admin' })");
        expect(koa.middleware.bodyParser("'json', 'multipart'")).toBe("bodyParserMiddleware(['json', 'multipart'])");
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
            const out = koa.mcpRouter({ path: '/tools' });
            expect(out).toContain("router.post('/tools',");
            expect(out).toContain("import { ServerKitRouter, bodyParserMiddleware, requireSignature } from '@maroonedsoftware/koa';");
            expect(out).toContain('const dispatcher = ctx.container.get(McpDispatcher);');
        });

        it('escapes the backticks in its own doc comment rather than closing the template', () => {
            expect(koa.mcpRouter({ path: '/mcp' })).toContain('Bind `registerMcpTools` to the `McpToolHandlerMap` token.');
        });
    });
});
