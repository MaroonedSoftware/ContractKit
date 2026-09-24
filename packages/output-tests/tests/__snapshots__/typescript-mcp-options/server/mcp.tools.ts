import { Injectable, type Container, type Registry } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerBillingMcpTools, registerBillingMcpCatalog, registerBillingMcpToolClasses } from './billing.mcp.js';
import { registerHyphenatedMcpTools, registerHyphenatedMcpCatalog, registerHyphenatedMcpToolClasses } from './hyphenated.mcp.js';
import { registerKitchenMcpCatalog, registerKitchenMcpToolClasses } from './kitchen.mcp.js';
import { registerReservedMcpTools, registerReservedMcpCatalog, registerReservedMcpToolClasses } from './reserved.mcp.js';
import { registerSimpleMcpCatalog, registerSimpleMcpToolClasses } from './simple.mcp.js';

/**
 * Build the MCP tool map: the tools `tools/list` reports.
 *
 * Bind it to the `McpToolHandlerMap` token from a factory, which is what supplies the
 * `Container` needed to resolve each handler:
 *
 * ```ts
 * registry.register(McpToolHandlerMap).useFactory(registerMcpTools).asSingleton();
 * ```
 */
export function registerMcpTools(container: Container): McpToolHandlerMap {
    const map = new McpToolHandlerMap();
    registerBillingMcpTools(map, container);
    registerHyphenatedMcpTools(map, container);
    registerReservedMcpTools(map, container);
    return map;
}

/**
 * A handler for every operation a tool can serve, flagged `mcp:` or not, kept apart from the
 * listed tools. Its own token, since `McpToolHandlerMap` is bound to `registerMcpTools`.
 */
@Injectable()
export class McpToolCatalog extends McpToolHandlerMap {}

/**
 * Build the catalog. Nothing lists it: a meta tool (one that searches the API, say) looks a
 * handler up by name and calls it. Bind it from a factory, as `registerMcpTools` is bound:
 *
 * ```ts
 * registry.register(McpToolCatalog).useFactory(registerMcpCatalog).asSingleton();
 * ```
 */
export function registerMcpCatalog(container: Container): McpToolCatalog {
    const map = new McpToolCatalog();
    registerBillingMcpCatalog(map, container);
    registerHyphenatedMcpCatalog(map, container);
    registerKitchenMcpCatalog(map, container);
    registerReservedMcpCatalog(map, container);
    registerSimpleMcpCatalog(map, container);
    return map;
}

/**
 * Register every generated tool class on the registry, so the tool maps can resolve them:
 *
 * ```ts
 * registerMcpToolClasses(registry);
 * ```
 */
export function registerMcpToolClasses(registry: Registry): void {
    registerBillingMcpToolClasses(registry);
    registerHyphenatedMcpToolClasses(registry);
    registerKitchenMcpToolClasses(registry);
    registerReservedMcpToolClasses(registry);
    registerSimpleMcpToolClasses(registry);
}
