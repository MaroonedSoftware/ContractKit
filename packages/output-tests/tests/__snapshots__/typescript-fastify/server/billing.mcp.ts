// Auto-generated MCP tools
// generated from [billing.ck](../contracts/billing.ck)
import { Injectable, type Container } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';
import { PaymentService } from '#src/services/payment.service.js';
import { Payment, PaymentRef, PaymentScope, SavedSearch, ScopedFilter, SnakeFilter, SnakeHeaders } from './schemas/billing.schema.js';

const GetRefundArgs = z.object({ params: PaymentRef });
const SearchPaymentsByDateArgs = z.object({ query: SnakeFilter.optional(), headers: SnakeHeaders.optional() });
const SearchPaymentsScopedArgs = z.object({ query: SnakeFilter.in.extend({
    q: z.string(),
}).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
})).optional(), headers: SnakeHeaders.in.extend({
    xTrace: z.string().optional(),
}).transform(({ tenant_id: _0, ...rest }) => ({
    ...rest,
    ...SnakeHeaders.out.parse({ tenant_id: _0 }),
})).optional() });
const SaveScopedSearchArgs = z.object({ body: PaymentScope.extend(SnakeFilter.in.shape).transform(({ from_date: _0, tag_ids: _1, ...rest }) => ({
    ...rest,
    ...SnakeFilter.out.parse({ from_date: _0, tag_ids: _1 }),
})), query: ScopedFilter.optional() });

/**
 * from [billing.ck](../contracts/billing.ck#L186)
 */
@Injectable()
export class GetRefundMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_refund',
        description: 'look up a refund by its originating payment',
        inputSchema: z.toJSONSchema(GetRefundArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    constructor(private readonly service: PaymentService, private readonly policies: PolicyService) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });
        const { params } = await parseAndValidate(args, GetRefundArgs);
        const result = await this.service.getRefund(params);
        const resultJson = JSON.stringify(result, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L240)
 */
@Injectable()
export class SearchPaymentsByDateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_payments_by_date',
        description: 'search payments with snake_case filter and header models',
        inputSchema: z.toJSONSchema(SearchPaymentsByDateArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
    };

    constructor(private readonly service: PaymentService, private readonly policies: PolicyService) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, SearchPaymentsByDateArgs);
        await this.service.searchByDate(query, headers);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L271)
 */
@Injectable()
export class SearchPaymentsScopedMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_payments_scoped',
        description: 'search payments with a snake_case filter extended inline',
        inputSchema: z.toJSONSchema(SearchPaymentsScopedArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
    };

    constructor(private readonly service: PaymentService, private readonly policies: PolicyService) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, SearchPaymentsScopedArgs);
        const result = await this.service.searchScoped(query, headers);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L281)
 */
@Injectable()
export class SaveScopedSearchMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'save_scoped_search',
        description: 'save a scoped search',
        inputSchema: z.toJSONSchema(SaveScopedSearchArgs, { unrepresentable: 'any' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SavedSearch, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    constructor(private readonly service: PaymentService, private readonly policies: PolicyService) {}

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        await requireMcpPolicy(context, this.policies, { policy: MFA_SATISFIED_POLICY });
        const { body, query } = await parseAndValidate(args, SaveScopedSearchArgs);
        const result = await this.service.saveScopedSearch(body, query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the shared catalog. */
export function registerBillingMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_refund', container.get(GetRefundMcpTool));
    map.set('search_payments_by_date', container.get(SearchPaymentsByDateMcpTool));
    map.set('search_payments_scoped', container.get(SearchPaymentsScopedMcpTool));
    map.set('save_scoped_search', container.get(SaveScopedSearchMcpTool));
}
