// Auto-generated MCP tools
// generated from [simple.ck](../contracts/simple.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { StatusService } from '#src/services/status.service.js';
import { Heartbeat } from './schemas/simple.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetStatusArgs = z.object({});

/**
 * from [simple.ck](../contracts/simple.ck#L14)
 */
@Injectable()
export class GetStatusMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_status',
        description: 'current service status',
        inputSchema: z.toJSONSchema(GetStatusArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Heartbeat, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const result = await container.get(StatusService).get();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerSimpleMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_status', container.get(GetStatusMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerSimpleMcpToolClasses(registry: Registry): void {
    registry.register(GetStatusMcpTool).useClass(GetStatusMcpTool).asSingleton();
}
