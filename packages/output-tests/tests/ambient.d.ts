/**
 * Stand-ins for everything the generated code imports from outside itself.
 *
 * `zod` is not here: it is installed, and the typecheck maps the specifier onto the real package
 * (see `typecheck.test.ts`). Getting `z.infer<...>` right matters, because the emitted type
 * aliases are built from it and a stub would make every one of them vacuously `any`.
 *
 * The rest are declared just precisely enough to be usable in the positions the generated code
 * puts them in — a shorthand `declare module 'luxon';` types the module `any`, which then fails
 * every *type* position with "cannot use namespace as a type" and buries the real diagnostics.
 * Members are `any` on purpose: this baseline is about whether the generated code is internally
 * consistent, not whether it agrees with a particular release of Luxon or ServerKit.
 *
 * `#src/*` covers the service implementations the routers import. Those are files the user writes;
 * there is nothing generated behind them to check.
 */

declare module 'luxon' {
    export class DateTime {
        static fromISO(s: string, opts?: any): DateTime;
        static fromFormat(s: string, fmt: string, opts?: any): DateTime;
        [key: string]: any;
    }
    export class Duration {
        static fromISO(s: string, opts?: any): Duration;
        [key: string]: any;
    }
    export class Interval {
        static fromISO(s: string, opts?: any): Interval;
        [key: string]: any;
    }
}

declare module 'decimal.js' {
    export class Decimal {
        constructor(value: string | number | Decimal);
        static set(config: any): void;
        static isDecimal(value: unknown): value is Decimal;
        [key: string]: any;
    }
    export default Decimal;
}

declare module 'injectkit' {
    export function Injectable(): ClassDecorator;
    export class Container {
        get<T>(token: any): T;
        register(token: any, provider: any): void;
    }
}

declare module '@maroonedsoftware/koa' {
    /**
     * Handlers are declared rather than left to a rest-`any[]`, so the emitted `async ctx => …`
     * arrows pick up a contextual type. Without one every route handler reports an implicit-any
     * parameter, which is a fact about this stub and not about the generated router.
     */
    type RouteHandler = (ctx: any) => any;
    export interface ServerKitRouterInstance {
        get(path: string, ...handlers: RouteHandler[]): void;
        post(path: string, ...handlers: RouteHandler[]): void;
        put(path: string, ...handlers: RouteHandler[]): void;
        patch(path: string, ...handlers: RouteHandler[]): void;
        delete(path: string, ...handlers: RouteHandler[]): void;
    }
    export function ServerKitRouter(): ServerKitRouterInstance;
    export function bodyParserMiddleware(kinds: string[]): RouteHandler;
    export function requirePolicy(options?: { policy?: string | false }): RouteHandler;
    export function requireSignature(name: string, opts?: any): RouteHandler;
}

declare module 'fastify' {
    /**
     * Both parameters are typed for the same reason the Koa stub types its one: without a contextual
     * type every emitted `async (request, reply) => …` arrow reports two implicit-any parameters,
     * which is a fact about this stub and not about the generated router. The return type stays `any`
     * so `return reply.send(...)` is assignable wherever the generator puts it.
     */
    type RouteHandler = (request: any, reply: any) => any;
    /** What a route's `preHandler` entries look like — `requirePolicy()` and `requireSignature(...)`. */
    type RouteGuard = (request: any, ...rest: any[]) => any;
    export interface FastifyRouteOptions {
        config?: { body?: string[] };
        preHandler?: RouteGuard[];
        [key: string]: any;
    }
    /**
     * Two overloads per method — with and without the `{ config, preHandler }` options object —
     * because a route with neither a body allow-list nor a guard omits it entirely.
     */
    export interface FastifyInstance {
        get(path: string, handler: RouteHandler): this;
        get(path: string, options: FastifyRouteOptions, handler: RouteHandler): this;
        post(path: string, handler: RouteHandler): this;
        post(path: string, options: FastifyRouteOptions, handler: RouteHandler): this;
        put(path: string, handler: RouteHandler): this;
        put(path: string, options: FastifyRouteOptions, handler: RouteHandler): this;
        patch(path: string, handler: RouteHandler): this;
        patch(path: string, options: FastifyRouteOptions, handler: RouteHandler): this;
        delete(path: string, handler: RouteHandler): this;
        delete(path: string, options: FastifyRouteOptions, handler: RouteHandler): this;
    }
    export type FastifyPluginAsync = (app: FastifyInstance) => Promise<void>;
}

declare module '@maroonedsoftware/fastify' {
    /** What a route's `preHandler` entries look like — matches the `fastify` stub's own `RouteGuard`. */
    type RouteGuard = (request: any, ...rest: any[]) => any;
    export function requirePolicy(options?: { policy?: string | false }): RouteGuard;
    export function requireSignature(optionsKey: string, opts?: any): RouteGuard;
}

declare module '@maroonedsoftware/zod' {
    /**
     * Inferred through the schema's own `parse` rather than declared `<T>(v, schema: any)`, which
     * would leave `T` with no inference site and resolve every parsed body to `unknown`.
     */
    export function parseAndValidate<T>(value: unknown, schema: { parse(input: unknown): T }): Promise<T>;
}

declare module '@maroonedsoftware/multipart' {
    export class MultipartBody {
        [key: string]: any;
    }
}

declare module '@maroonedsoftware/mcp' {
    export interface McpToolContext {
        [key: string]: any;
    }
    export interface McpToolHandler {
        readonly definition: any;
        handle(args: Record<string, unknown>, context: McpToolContext): Promise<any>;
    }
    export class McpToolHandlerMap {
        set(name: string, handler: McpToolHandler): void;
    }
    export class McpDispatcher {
        [key: string]: any;
    }
    export function createMcpRequestContext(opts: any): any;
    export const MCP_AUTH_POLICY: string;
    /** The per-tool session-plus-policy guard a generated handler opens with. */
    export function requireMcpPolicy(context: McpToolContext, policies: any, options?: { policy?: string | false }): Promise<any>;
}

declare module '@maroonedsoftware/policies' {
    export class PolicyService {
        assert(policyName: string, context: any, statusCode?: number): Promise<void>;
    }
}

declare module '@maroonedsoftware/authentication' {
    /** `'auth.session.mfa.satisfied'` — the gate `requirePolicy()` applies by default. */
    export const MFA_SATISFIED_POLICY: string;
}

declare module '@modelcontextprotocol/sdk/types.js' {
    export interface Tool {
        name: string;
        description?: string;
        inputSchema: any;
        outputSchema?: any;
    }
    export interface CallToolResult {
        content: any[];
        structuredContent?: any;
    }
}

/**
 * The service implementations the routers and MCP tools import. Declared one by one rather than as
 * a `#src/*` wildcard, because a wildcard resolves to `any` and every `PaymentService` in a type
 * position then reports "cannot use namespace as a type". These are files the user writes; there
 * is nothing generated behind them to check, so the members are open.
 */
declare module '#src/services/payment.service.js' {
    export class PaymentService {
        [key: string]: any;
    }
}
declare module '#src/services/invoice.service.js' {
    export class InvoiceService {
        [key: string]: any;
    }
}
declare module '#src/services/status.service.js' {
    export class StatusService {
        [key: string]: any;
    }
}
