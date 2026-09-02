import { KOA_SERVER_FRAMEWORK } from './server-framework-koa.js';

/**
 * HTTP frameworks the server sub-generator can target. Adding a name here without adding an adapter
 * to {@link SERVER_FRAMEWORKS} fails to compile, which is the point of keeping the two in step.
 */
export const SERVER_FRAMEWORK_NAMES = ['koa'] as const;

/** One of {@link SERVER_FRAMEWORK_NAMES}. */
export type ServerFrameworkName = (typeof SERVER_FRAMEWORK_NAMES)[number];

/** The framework assumed when a config names none. */
export const DEFAULT_SERVER_FRAMEWORK_NAME: ServerFrameworkName = 'koa';

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

    /** The module-level router value every handler attaches to. */
    routerDeclaration(routerName: string): string;

    /** Placeholder syntax for one path parameter, given a name already mapped to a valid identifier. */
    pathParam(identifier: string): string;

    /** Opening line of a handler, including its middleware and the handler function's parameters. */
    routeOpen(routerName: string, method: string, path: string, middlewares: readonly string[]): string;

    /** Lines that close a handler opened by {@link routeOpen}. */
    routeClose(): string[];

    /** Route middleware factory calls, rendered as expressions for {@link routeOpen}. */
    readonly middleware: {
        policy(args: string): string;
        bodyParser(tokensExpr: string): string;
        signature(args: string): string;
    };

    /** Expressions a handler reads the request through. */
    readonly request: {
        params: string;
        query: string;
        headers: string;
        /** The body already parsed by the body-parser middleware. */
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
