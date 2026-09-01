import { type Container } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerBillingMcpTools } from './billing.mcp.js';
import { registerHyphenatedMcpTools } from './hyphenated.mcp.js';

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
    return map;
}
