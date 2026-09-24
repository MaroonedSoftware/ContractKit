// Auto-generated MCP tools
// generated from [hyphenated.ck](../contracts/hyphenated.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { InvoiceService } from '#src/services/invoice.service.js';
import { Invoice } from './schemas/hyphenated.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetInvoiceArgs = z.object({ invoiceId: z.uuid() });

/**
 * from [hyphenated.ck](../contracts/hyphenated.ck#L22)
 */
@Injectable()
export class GetInvoiceMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_invoice',
        description: 'fetch an invoice',
        inputSchema: z.toJSONSchema(GetInvoiceArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Invoice, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { invoiceId } = await parseAndValidate(args, GetInvoiceArgs);
        const result = await container.get(InvoiceService).getById(invoiceId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the shared catalog. */
export function registerHyphenatedMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_invoice', container.get(GetInvoiceMcpTool));
}

/** Register this file's tool classes on the registry, so the catalog can resolve them. */
export function registerHyphenatedMcpToolClasses(registry: Registry): void {
    registry.register(GetInvoiceMcpTool).useClass(GetInvoiceMcpTool).asSingleton();
}
