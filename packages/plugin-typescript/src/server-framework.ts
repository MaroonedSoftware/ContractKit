import { KOA_SERVER_FRAMEWORK } from './server-framework-koa.js';
import { FASTIFY_SERVER_FRAMEWORK } from './server-framework-fastify.js';

/**
 * HTTP frameworks the server sub-generator can target. Adding a name here without adding an adapter
 * to {@link SERVER_FRAMEWORKS} fails to compile, which is the point of keeping the two in step.
 */
export const SERVER_FRAMEWORK_NAMES = ['koa', 'fastify'] as const;

/** One of {@link SERVER_FRAMEWORK_NAMES}. */
export type ServerFrameworkName = (typeof SERVER_FRAMEWORK_NAMES)[number];

/** The framework assumed when a config names none. */
export const DEFAULT_SERVER_FRAMEWORK_NAME: ServerFrameworkName = 'koa';

/**
 * Per-route guards and body declaration, reduced to what {@link ServerFramework.routeOpen} needs.
 * `policy` and `signature` are already-rendered call expressions, built by the generator through
 * {@link ServerFramework.middleware}, because both frameworks spell a guard as a call in a list —
 * only the list's shape differs. `bodyContentTypes` stays raw MIME strings rather than a rendered
 * call: Koa collapses them into `bodyParserMiddleware` tokens as another guard, while Fastify
 * declares them literally as `config.body`, data a route reads rather than a hook it runs.
 */
export interface RouteMiddleware {
    /** `requirePolicy(...)` call expression, or undefined when the operation declares no security. */
    policy?: string;
    /**
     * Request body MIME types the operation declares, in source order and deduped by exact string.
     * Undefined (or empty) when the operation has no body.
     */
    bodyContentTypes?: readonly string[];
    /** `requireSignature(...)` call expression, or undefined when the operation declares no signature. */
    signature?: string;
}

/**
 * Every framework-specific string the router and MCP router generators emit.
 *
 * Granularity is one statement (or one fragment) per method, so the shared codegen keeps ownership
 * of control flow — which branches exist, what order they run in, and which values reach them — and
 * an adapter only decides how a given step is spelled. Anything an adapter cannot express as a
 * statement, such as ending a response, is returned as a list of lines so it can also be empty.
 */
export interface ServerFramework {
    readonly name: ServerFrameworkName;

    /**
     * Import lines for the framework runtime, already filtered down to what the generated body uses.
     *
     * The adapter applies `uses` itself rather than declaring a symbol list, because a framework may
     * need more than one import line, and because only names the adapter chooses ever go through the
     * word-boundary probe — a handler-local identifier can never be mistaken for an import.
     */
    imports(uses: (symbol: string) => boolean): string[];

    /** The exported router/plugin constant name for a file's base name, e.g. `Billing` → `BillingRouter` (Koa) or `BillingRoutes` (Fastify). */
    routerName(baseName: string): string;

    /**
     * Opening line of the router declaration. For a framework whose routes are written inside a
     * function body — Fastify's plugin — this ends with the opening brace, paired with
     * {@link routerClose}; for one whose routes are top-level statements against an exported value —
     * Koa's router — it is the whole declaration.
     */
    routerDeclaration(routerName: string): string;

    /**
     * Whether {@link routerDeclaration} opens a block that every route is written inside, rather than
     * a bare value routes are called against. When true, the generator indents each route one level
     * and appends {@link routerClose} after the last one.
     */
    readonly routerWrapsRoutes: boolean;

    /** Lines closing the block {@link routerDeclaration} opened. Empty when {@link routerWrapsRoutes} is false. */
    routerClose(): string[];

    /** Placeholder syntax for one path parameter, given a name already mapped to a valid identifier. */
    pathParam(identifier: string): string;

    /**
     * Identifiers the handler signature itself binds — `ctx`, or `request` and `reply`. A path
     * parameter is destructured into the handler body, so one declared with the same name would
     * shadow the handler's own parameter: a redeclaration under `tsc`, and a temporal-dead-zone
     * `ReferenceError` at runtime. Codegen renames the local binding to avoid these.
     */
    readonly handlerLocals: readonly string[];

    /**
     * Opening line of a handler, including its guards and the handler function's parameters.
     *
     * `routerName` is the value in scope for a framework whose routes are top-level statements
     * against it (Koa); a framework whose routes are written inside the router's own function body
     * (Fastify) ignores it and calls its own parameter instead.
     */
    routeOpen(routerName: string, method: string, path: string, guards: RouteMiddleware): string;

    /** Lines that close a handler opened by {@link routeOpen}. */
    routeClose(): string[];

    /**
     * Route guard factory calls, rendered as expressions for {@link RouteMiddleware.policy} and
     * {@link RouteMiddleware.signature}. Body parsing has no entry here: Koa and Fastify disagree on
     * what a route does with the declared MIME types, so {@link routeOpen} renders
     * {@link RouteMiddleware.bodyContentTypes} itself instead of going through a shared factory.
     */
    readonly middleware: {
        policy(args: string): string;
        signature(args: string): string;
    };

    /** Expressions a handler reads the request through. */
    readonly request: {
        params: string;
        query: string;
        headers: string;
        /** The body already parsed by the body parser. */
        parsedBody: string;
        /**
         * The request's media type with any parameters stripped. It is matched against declared MIME
         * literals, so an adapter whose framework exposes only the raw header must normalise it here
         * — a `; charset=utf-8` left on the end matches nothing.
         */
        contentType: string;
    };

    /** Expression resolving a service class out of the request-scoped DI container. */
    resolveService(className: string): string;

    /** Statements a handler writes the response with. */
    readonly response: {
        status(expr: string): string;
        /**
         * One statement setting a response header. It is emitted bare or behind an `if` guard for an
         * optional header, so it must stay a single statement.
         */
        header(name: string, valueExpr: string): string;
        type(expr: string): string;
        /**
         * The terminal write for a response, or for one without a body when `bodyExpr` is undefined.
         * A framework that ends a response by returning needs a statement in both cases; Koa, which
         * ends it by assignment, emits nothing for a bodyless one.
         */
        send(bodyExpr: string | undefined): string[];
        /** What closes one `case` of the multi-status switch, after that status has been written. */
        caseEnd(): string[];
    };

    /** The whole `mcp.router.ts` file, which is boilerplate rather than a per-operation render. */
    mcpRouter(options: { path: string }): string;
}

/**
 * Every supported framework, keyed by name. The annotation is what ties this to
 * {@link SERVER_FRAMEWORK_NAMES}: adding a name without an adapter is a compile error.
 */
export const SERVER_FRAMEWORKS: Readonly<Record<ServerFrameworkName, ServerFramework>> = {
    koa: KOA_SERVER_FRAMEWORK,
    fastify: FASTIFY_SERVER_FRAMEWORK,
};

/**
 * Resolve a configured framework name to its adapter.
 *
 * @param name The `server.framework` value, or undefined for {@link DEFAULT_SERVER_FRAMEWORK_NAME}.
 * @throws When `name` is not a supported framework. Config arrives as JSON, so this is a runtime
 *   check and not something the `ServerFrameworkName` type can enforce on its own.
 */
export function resolveServerFramework(name: string | undefined): ServerFramework {
    const resolved = name ?? DEFAULT_SERVER_FRAMEWORK_NAME;
    const framework = (SERVER_FRAMEWORKS as Record<string, ServerFramework | undefined>)[resolved];
    if (!framework) {
        throw new Error(
            `plugin-typescript: server.framework '${resolved}' is not supported — expected one of: ${SERVER_FRAMEWORK_NAMES.join(', ')}.`,
        );
    }
    return framework;
}
