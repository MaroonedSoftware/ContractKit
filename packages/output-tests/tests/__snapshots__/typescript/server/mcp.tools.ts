import { type Container, type Registry } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerBillingMcpTools, registerBillingMcpToolClasses } from './billing.mcp.js';
import { registerHyphenatedMcpTools, registerHyphenatedMcpToolClasses } from './hyphenated.mcp.js';
import { registerReservedMcpTools, registerReservedMcpToolClasses } from './reserved.mcp.js';

/**
 * Build the MCP tool catalog.
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
 * Register every generated tool class on the registry, so `registerMcpTools` can resolve it:
 *
 * ```ts
 * registerMcpToolClasses(registry);
 * ```
 */
export function registerMcpToolClasses(registry: Registry): void {
    registerBillingMcpToolClasses(registry);
    registerHyphenatedMcpToolClasses(registry);
    registerReservedMcpToolClasses(registry);
}
