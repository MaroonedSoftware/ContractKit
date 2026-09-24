// Auto-generated MCP tools
// generated from [billing.ck](../contracts/billing.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';
import { PaymentService } from '#src/services/payment.service.js';
import { Payment, PaymentFilter, PaymentRef, PaymentScope, SavedSearch, ScopedFilter, SnakeFilter, SnakeHeaders, TenantHeaders, serializeSavedSearch, serializeSnakeFilter } from './schemas/billing.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const SearchPaymentsArgs = z.object({ query: PaymentFilter.optional(), headers: TenantHeaders.optional() });
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

/** One response body as it is written, with every `date` and `time` in the text the SDK parses. Returns a copy. */
function __serializeSearchPaymentsScopedMcpToolResult(value: unknown): unknown {
    let __v: unknown = value;
    __v = serializeSnakeFilter(__v as never);
    return __v;
}

/**
 * from [billing.ck](../contracts/billing.ck#L108)
 */
@Injectable()
export class SearchPaymentsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_payments',
        description: 'search payments with a filter model',
        inputSchema: z.toJSONSchema(SearchPaymentsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(Payment) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, SearchPaymentsArgs);
        const result = await container.get(PaymentService).search(query, headers);
        const resultJson = JSON.stringify({ items: result }, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L187)
 */
@Injectable()
export class GetRefundMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_refund',
        description: 'look up a refund by its originating payment',
        inputSchema: z.toJSONSchema(GetRefundArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { params } = await parseAndValidate(args, GetRefundArgs);
        const result = await container.get(PaymentService).getRefund(params);
        const resultJson = JSON.stringify(result, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L241)
 */
@Injectable()
export class SearchPaymentsByDateMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_payments_by_date',
        description: 'search payments with snake_case filter and header models',
        inputSchema: z.toJSONSchema(SearchPaymentsByDateArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, SearchPaymentsByDateArgs);
        await container.get(PaymentService).searchByDate(query, headers);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L272)
 */
@Injectable()
export class SearchPaymentsScopedMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'search_payments_scoped',
        description: 'search payments with a snake_case filter extended inline',
        inputSchema: z.toJSONSchema(SearchPaymentsScopedArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, SearchPaymentsScopedArgs);
        const result = await container.get(PaymentService).searchScoped(query, headers);
        const resultJson = JSON.stringify(__serializeSearchPaymentsScopedMcpToolResult(result));
        return { content: [{ type: 'text', text: resultJson }] };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L282)
 */
@Injectable()
export class SaveScopedSearchMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'save_scoped_search',
        description: 'save a scoped search',
        inputSchema: z.toJSONSchema(SaveScopedSearchArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(SavedSearch, { unrepresentable: 'any' }) as Tool['outputSchema'],
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body, query } = await parseAndValidate(args, SaveScopedSearchArgs);
        const result = await container.get(PaymentService).saveScopedSearch(body, query);
        const resultJson = JSON.stringify(serializeSavedSearch(result));
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/** Add this file's tools to the shared catalog. */
export function registerBillingMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('search_payments', container.get(SearchPaymentsMcpTool));
    map.set('get_refund', container.get(GetRefundMcpTool));
    map.set('search_payments_by_date', container.get(SearchPaymentsByDateMcpTool));
    map.set('search_payments_scoped', container.get(SearchPaymentsScopedMcpTool));
    map.set('save_scoped_search', container.get(SaveScopedSearchMcpTool));
}

/** Register this file's tool classes on the registry, so the catalog can resolve them. */
export function registerBillingMcpToolClasses(registry: Registry): void {
    registry.register(SearchPaymentsMcpTool).useClass(SearchPaymentsMcpTool).asSingleton();
    registry.register(GetRefundMcpTool).useClass(GetRefundMcpTool).asSingleton();
    registry.register(SearchPaymentsByDateMcpTool).useClass(SearchPaymentsByDateMcpTool).asSingleton();
    registry.register(SearchPaymentsScopedMcpTool).useClass(SearchPaymentsScopedMcpTool).asSingleton();
    registry.register(SaveScopedSearchMcpTool).useClass(SaveScopedSearchMcpTool).asSingleton();
}
