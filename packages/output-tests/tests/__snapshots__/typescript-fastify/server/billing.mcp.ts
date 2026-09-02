// Auto-generated MCP tools
// generated from [billing.ck](../contracts/billing.ck)
import { Injectable, type Container } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpToolHandler, McpToolHandlerMap, McpToolContext } from '@maroonedsoftware/mcp';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { PaymentService } from '#src/services/payment.service.js';
import { Payment, PaymentRef } from './schemas/billing.schema.js';

const GetRefundArgs = z.object({ params: PaymentRef });

/**
 * from [billing.ck](../contracts/billing.ck#L147)
 */
@Injectable()
export class GetRefundMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_refund',
        description: 'look up a refund by its originating payment',
        inputSchema: z.toJSONSchema(GetRefundArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    constructor(private readonly service: PaymentService) {}

    async handle(args: Record<string, unknown>, _context: McpToolContext): Promise<CallToolResult> {
        const { params } = await parseAndValidate(args, GetRefundArgs);
        const result = await this.service.getRefund(params);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the shared catalog. */
export function registerBillingMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_refund', container.get(GetRefundMcpTool));
}
