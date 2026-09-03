import { describe, it, expect } from 'vitest';
import { FASTIFY_SERVER_FRAMEWORK as fastify } from '../src/server-framework-fastify.js';

/**
 * Pinned method by method, the way the Koa adapter is. These strings are the contract with
 * `@maroonedsoftware/fastify`'s native-Fastify API (0.3+), so a change to any of them should fail
 * here, naming the piece, rather than only as a snapshot diff in another package.
 */
describe('FASTIFY_SERVER_FRAMEWORK', () => {
    it('is named fastify', () => {
        expect(fastify.name).toBe('fastify');
    });

    describe('imports', () => {
        it('always imports the FastifyPluginAsync type, and every guard the body uses', () => {
            expect(fastify.imports(() => true)).toEqual([
                "import type { FastifyPluginAsync } from 'fastify';",
                "import { requirePolicy, requireSignature } from '@maroonedsoftware/fastify';",
            ]);
        });

        it('narrows the runtime import to the guards the body actually references', () => {
            expect(fastify.imports(s => s === 'requirePolicy')).toEqual([
                "import type { FastifyPluginAsync } from 'fastify';",
                "import { requirePolicy } from '@maroonedsoftware/fastify';",
            ]);
        });

        it('still imports the type when the body uses no guard at all', () => {
            expect(fastify.imports(() => false)).toEqual(["import type { FastifyPluginAsync } from 'fastify';"]);
        });
    });

    it('names the router with a Routes suffix, matching the plugin idiom', () => {
        expect(fastify.routerName('Billing')).toBe('BillingRoutes');
    });

    it('declares the router as a FastifyPluginAsync, opening its body', () => {
        expect(fastify.routerDeclaration('UsersRoutes')).toBe('export const UsersRoutes: FastifyPluginAsync = async app => {');
    });

    it('wraps its routes inside the plugin body and closes it', () => {
        expect(fastify.routerWrapsRoutes).toBe(true);
        expect(fastify.routerClose()).toEqual(['};']);
    });

    it('renders a path parameter with a colon', () => {
        expect(fastify.pathParam('userId')).toBe(':userId');
    });

    it('reserves the two identifiers its handler signature binds', () => {
        expect(fastify.handlerLocals).toEqual(['request', 'reply']);
    });

    describe('routeOpen', () => {
        it('registers on the plugin parameter, ignoring the router name it is given', () => {
            expect(fastify.routeOpen('UsersRoutes', 'get', '/users', {})).toBe("app.get('/users', async (request, reply) => {");
        });

        it('omits the options object entirely when there are no guards and no body', () => {
            expect(fastify.routeOpen('UsersRoutes', 'delete', '/users/:id', {})).toBe("app.delete('/users/:id', async (request, reply) => {");
        });

        it('lists policy and signature guards in preHandler, in order, with no config key', () => {
            expect(fastify.routeOpen('UsersRoutes', 'get', '/users', { policy: 'requirePolicy()', signature: "requireSignature('slack')" })).toBe(
                "app.get('/users', { preHandler: [requirePolicy(), requireSignature('slack')] }, async (request, reply) => {",
            );
        });

        it('declares the body allow-list as config.body, literally, not as a preHandler entry', () => {
            expect(fastify.routeOpen('UsersRoutes', 'post', '/users', { bodyContentTypes: ['application/json'] })).toBe(
                "app.post('/users', { config: { body: ['application/json'] } }, async (request, reply) => {",
            );
        });

        it('keeps every declared MIME literally, in source order — Fastify gates on the raw Content-Type, not a parser token', () => {
            expect(fastify.routeOpen('UsersRoutes', 'put', '/users', { bodyContentTypes: ['application/json', 'multipart/form-data'] })).toBe(
                "app.put('/users', { config: { body: ['application/json', 'multipart/form-data'] } }, async (request, reply) => {",
            );
        });

        it('combines config and preHandler in one options object when both apply', () => {
            expect(
                fastify.routeOpen('UsersRoutes', 'post', '/users', {
                    policy: 'requirePolicy()',
                    bodyContentTypes: ['application/json'],
                    signature: "requireSignature('slack')",
                }),
            ).toBe(
                "app.post('/users', { config: { body: ['application/json'] }, preHandler: [requirePolicy(), requireSignature('slack')] }, async (request, reply) => {",
            );
        });
    });

    it('closes a route', () => {
        expect(fastify.routeClose()).toEqual(['});']);
    });

    it("renders the route guard factories, which take the same arguments as Koa's", () => {
        expect(fastify.middleware.policy('')).toBe('requirePolicy()');
        expect(fastify.middleware.policy("{ policy: 'admin' }")).toBe("requirePolicy({ policy: 'admin' })");
        expect(fastify.middleware.signature("'slack'")).toBe("requireSignature('slack')");
    });

    it('reads the request off the request object, which is the context', () => {
        expect(fastify.request).toEqual({
            params: 'request.params',
            query: 'request.query',
            headers: 'request.headers',
            // Fastify's own request.body — bodyParserPlugin replaces the framework's content-type
            // parsers outright, so there is no separate `parsedBody` side channel any more.
            parsedBody: 'request.body',
            // Inlined rather than a runtime call: `requestMediaType` is gone from the package's public
            // surface. The raw header carries `; charset=…`, which matches no declared MIME literal.
            contentType: "(request.headers['content-type'] ?? '').split(';', 1)[0]!.trim()",
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

        it('mounts the dispatcher at the given path as a route plugin, not a function taking a router', () => {
            expect(fastify.mcpRouter({ path: '/tools' })).toContain("app.post(\n        '/tools',");
            expect(out).toContain("from '@maroonedsoftware/fastify'");
            expect(out).toContain('const dispatcher = request.container.get(McpDispatcher);');
            expect(out).toContain('export const mountMcp: FastifyPluginAsync = async app => {');
        });

        it('declares the body allow-list and the signature guard the same way a generated route would', () => {
            expect(out).toContain("config: { body: ['application/json'] }, preHandler: [requireSignature('mcp', { policy: MCP_AUTH_POLICY })] }");
        });

        it('never references ServerKitRouter or requestHeader — neither exists on the native-Fastify API', () => {
            expect(out).not.toContain('ServerKitRouter');
            expect(out).not.toContain('requestHeader');
        });

        it("hijacks the reply for a stateful session, which is Fastify's ctx.respond = false", () => {
            expect(out).toContain('reply.hijack();');
            expect(out).toContain('req: request.raw,');
            expect(out).toContain('res: reply.raw,');
        });

        it("reads Fastify's own request.body, not a parsedBody side channel", () => {
            expect(out).toContain('body: request.body,');
            expect(out).not.toContain('request.parsedBody');
        });

        it('takes the first value of a possibly-repeated session-id header, undefined when absent', () => {
            expect(out).toContain("sessionId: firstHeader(request.headers['mcp-session-id']),");
            expect(out).toContain('function firstHeader(value: string | string[] | undefined): string | undefined {');
            expect(out).toContain('return Array.isArray(value) ? value[0] : value;');
        });

        it('answers a notification with a bodyless 202', () => {
            expect(out).toContain('reply.status(202);');
            expect(out).toContain('return reply.send();');
        });

        it('escapes the backticks in its own doc comment rather than closing the template', () => {
            expect(out).toContain('bind `registerMcpTools` to the `McpToolHandlerMap` token.');
        });
    });
});
