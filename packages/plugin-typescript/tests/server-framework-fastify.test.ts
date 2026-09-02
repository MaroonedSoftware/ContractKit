import { describe, it, expect } from 'vitest';
import { FASTIFY_SERVER_FRAMEWORK as fastify } from '../src/server-framework-fastify.js';

/**
 * Pinned method by method, the way the Koa adapter is. These strings are the contract with
 * `@maroonedsoftware/fastify`, so a change to any of them should fail here, naming the piece,
 * rather than only as a snapshot diff in another package.
 */
describe('FASTIFY_SERVER_FRAMEWORK', () => {
    it('is named fastify', () => {
        expect(fastify.name).toBe('fastify');
    });

    describe('imports', () => {
        it('emits one line naming every symbol the body uses', () => {
            expect(fastify.imports(() => true)).toEqual([
                "import { ServerKitRouter, bodyParserMiddleware, requirePolicy, requireSignature, requestMediaType } from '@maroonedsoftware/fastify';",
            ]);
        });

        it('narrows to the symbols the body actually references', () => {
            expect(fastify.imports(s => s === 'requestMediaType')).toEqual(["import { requestMediaType } from '@maroonedsoftware/fastify';"]);
        });

        it('emits nothing when the body references none of them', () => {
            expect(fastify.imports(() => false)).toEqual([]);
        });
    });

    it('declares the router', () => {
        expect(fastify.routerDeclaration('UsersRouter')).toBe('export const UsersRouter = ServerKitRouter();');
    });

    it('renders a path parameter with a colon', () => {
        expect(fastify.pathParam('userId')).toBe(':userId');
    });

    it('reserves the two identifiers its handler signature binds', () => {
        expect(fastify.handlerLocals).toEqual(['request', 'reply']);
    });

    describe('routeOpen', () => {
        it('omits the middleware list when there is none', () => {
            expect(fastify.routeOpen('UsersRouter', 'get', '/users', [])).toBe("UsersRouter.get('/users', async (request, reply) => {");
        });

        it('places the middleware between the path and the handler', () => {
            expect(fastify.routeOpen('UsersRouter', 'post', '/users', ['requirePolicy()', "bodyParserMiddleware(['json'])"])).toBe(
                "UsersRouter.post('/users', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {",
            );
        });
    });

    it('closes a route', () => {
        expect(fastify.routeClose()).toEqual(['});']);
    });

    it('renders the route middleware factories, which take the same arguments as Koa\'s', () => {
        expect(fastify.middleware.policy('')).toBe('requirePolicy()');
        expect(fastify.middleware.policy("{ policy: 'admin' }")).toBe("requirePolicy({ policy: 'admin' })");
        expect(fastify.middleware.bodyParser("'json', 'multipart'")).toBe("bodyParserMiddleware(['json', 'multipart'])");
        expect(fastify.middleware.signature("'slack'")).toBe("requireSignature('slack')");
    });

    it('reads the request off the request object, which is the context', () => {
        expect(fastify.request).toEqual({
            params: 'request.params',
            query: 'request.query',
            headers: 'request.headers',
            parsedBody: 'request.parsedBody',
            // A call rather than a property: the raw header carries `; charset=…`, which matches no
            // declared MIME literal.
            contentType: 'requestMediaType(request)',
        });
    });

    it('resolves a service from the request container', () => {
        expect(fastify.resolveService('PaymentService')).toBe('request.container.get(PaymentService)');
    });

    describe('response', () => {
        it('sets the status through reply', () => {
            expect(fastify.response.status('200')).toBe('reply.status(200);');
            expect(fastify.response.status('result.status')).toBe('reply.status(result.status);');
        });

        it('sets a header as a single statement, so the optional guard can wrap it', () => {
            expect(fastify.response.header('x-request-id', 'String(result.headers["xRequestId"])')).toBe(
                'reply.header(\'x-request-id\', String(result.headers["xRequestId"]));',
            );
        });

        it('sets the content type', () => {
            expect(fastify.response.type("'application/json'")).toBe("reply.type('application/json');");
            expect(fastify.response.type('result.contentType')).toBe('reply.type(result.contentType);');
        });

        it('returns the send, including for a response with no body', () => {
            expect(fastify.response.send('result')).toEqual(['return reply.send(result);']);
            // Unlike Koa: a handler that neither returns a body nor calls send leaves the request hanging.
            expect(fastify.response.send(undefined)).toEqual(['return reply.send();']);
        });

        it('closes a status case with nothing, since the case already returned', () => {
            expect(fastify.response.caseEnd()).toEqual([]);
        });
    });

    describe('mcpRouter', () => {
        const out = fastify.mcpRouter({ path: '/mcp' });

        it('mounts the dispatcher at the given path', () => {
            expect(fastify.mcpRouter({ path: '/tools' })).toContain("router.post('/tools',");
            expect(out).toContain("from '@maroonedsoftware/fastify'");
            expect(out).toContain('const dispatcher = request.container.get(McpDispatcher);');
        });

        it('names the exported router type rather than inferring it', () => {
            expect(out).toContain('export function mountMcp(router: ServerKitRouterType): void {');
        });

        it('hijacks the reply for a stateful session, which is Fastify\'s ctx.respond = false', () => {
            expect(out).toContain('reply.hijack();');
            expect(out).toContain('req: request.raw,');
            expect(out).toContain('res: reply.raw,');
        });

        it('reads the parsed body, not Fastify\'s own request.body', () => {
            expect(out).toContain('body: request.parsedBody,');
            expect(out).not.toContain('request.body,');
        });

        it('passes undefined rather than the empty string for an absent session id', () => {
            expect(out).toContain("sessionId: requestHeader(request, 'mcp-session-id') || undefined,");
        });

        it('answers a notification with a bodyless 202', () => {
            expect(out).toContain('reply.status(202);');
            expect(out).toContain('return reply.send();');
        });

        it('escapes the backticks in its own doc comment rather than closing the template', () => {
            expect(out).toContain('Bind `registerMcpTools` to the `McpToolHandlerMap` token.');
        });
    });
});
