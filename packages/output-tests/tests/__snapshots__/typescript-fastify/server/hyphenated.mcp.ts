// Auto-generated MCP tools
// generated from [hyphenated.ck](../contracts/hyphenated.ck)
import { Injectable, type Container } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { InvoiceService } from '#src/services/invoice.service.js';
import { Invoice } from './schemas/hyphenated.schema.js';

const GetInvoiceArgs = z.object({ invoiceId: z.uuid() });

/**
 * from [hyphenated.ck](../contracts/hyphenated.ck#L22)
 */
@Injectable()
export class GetInvoiceMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_invoice',
        description: 'fetch an invoice',
        inputSchema: z.toJSONSchema(GetInvoiceArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Invoice, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    constructor(private readonly service: InvoiceService, private readonly policies: PolicyService) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });
        const { invoiceId } = await parseAndValidate(args, GetInvoiceArgs);
        const result = await this.service.getById(invoiceId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the shared catalog. */
export function registerHyphenatedMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_invoice', container.get(GetInvoiceMcpTool));
}
