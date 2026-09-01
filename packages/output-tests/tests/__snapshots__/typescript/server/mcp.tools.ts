import { type Container } from 'injectkit';
import { McpToolHandlerMap } from '@maroonedsoftware/mcp';
import { registerBillingMcpTools } from './billing.mcp.js';
import { registerHyphenatedMcpTools } from './hyphenated.mcp.js';

/** Build + register the MCP tool catalog. Call once at startup. */
export function registerMcpTools(container: Container): McpToolHandlerMap {
    const map = new McpToolHandlerMap();
    registerBillingMcpTools(map, container);
    registerHyphenatedMcpTools(map, container);
    container.register(McpToolHandlerMap, { useValue: map });
    return map;
}
