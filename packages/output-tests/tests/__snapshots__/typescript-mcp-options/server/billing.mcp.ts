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
import { AdminCredentialInput, Credential, Payment, PaymentFilter, PaymentInput, PaymentRef, PaymentScope, SavedSearch, ScopedFilter, Session, SessionInput, SnakeFilter, SnakeHeaders, TenantHeaders, UpdatePaymentForm, serializeSavedSearch, serializeSnakeFilter } from './schemas/billing.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const CreatePaymentArgs = z.object({ body: PaymentInput });
const ListPaymentsArgs = z.object({ query: z.object({ limit: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()), cursor: z.string(), status: z.enum(["pending", "completed", "failed"]) }).optional(), headers: z.object({ 'api-key': z.string(), 'x-tenant': z.string() }).optional() });
const SearchPaymentsArgs = z.object({ query: PaymentFilter.optional(), headers: TenantHeaders.optional() });
const CreatePaymentsArgs = z.object({ body: z.array(PaymentInput) });
const GetPaymentArgs = z.object({ paymentId: z.uuid() });
const UpdatePaymentWithFormArgs = z.object({ paymentId: z.uuid(), body: UpdatePaymentForm });
const DeletePaymentArgs = z.object({ paymentId: z.uuid() });
const GetRefundArgs = z.object({ params: PaymentRef });
const CreateCredentialArgs = z.object({ body: AdminCredentialInput });
const CreateSessionArgs = z.object({ body: SessionInput });
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
 * from [billing.ck](../contracts/billing.ck#L69)
 */
@Injectable()
export class CreatePaymentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_payment',
        description: 'create a payment',
        inputSchema: z.toJSONSchema(CreatePaymentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body } = await parseAndValidate(args, CreatePaymentArgs);
        const result = await container.get(PaymentService).create(body);
        const resultJson = JSON.stringify(result, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L89)
 */
@Injectable()
export class ListPaymentsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_payments',
        description: 'list payments',
        inputSchema: z.toJSONSchema(ListPaymentsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(Payment) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { query, headers } = await parseAndValidate(args, ListPaymentsArgs);
        const result = await container.get(PaymentService).list(query, headers);
        const resultJson = JSON.stringify({ items: result }, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
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
 * from [billing.ck](../contracts/billing.ck#L121)
 */
@Injectable()
export class CreatePaymentsMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_payments',
        description: 'create several payments at once',
        inputSchema: z.toJSONSchema(CreatePaymentsArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(Payment) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body } = await parseAndValidate(args, CreatePaymentsArgs);
        const result = await container.get(PaymentService).createBatch(body);
        const resultJson = JSON.stringify({ items: result }, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L138)
 */
@Injectable()
export class GetPaymentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_payment',
        description: 'fetch one payment',
        inputSchema: z.toJSONSchema(GetPaymentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Payment, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { paymentId } = await parseAndValidate(args, GetPaymentArgs);
        const result = await container.get(PaymentService).getById(paymentId);
        const resultJson = JSON.stringify(result, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L147)
 */
@Injectable()
export class UpdatePaymentWithFormMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'update_payment_with_form',
        description: 'update a payment with form data',
        inputSchema: z.toJSONSchema(UpdatePaymentWithFormArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { paymentId, body } = await parseAndValidate(args, UpdatePaymentWithFormArgs);
        await container.get(PaymentService).updateWithForm(paymentId, body);
        return { content: [{ type: 'text', text: 'OK' }] };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L158)
 */
@Injectable()
export class DeletePaymentMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'delete_payment',
        description: 'delete a payment — declares only a documented error status',
        inputSchema: z.toJSONSchema(DeletePaymentArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { paymentId } = await parseAndValidate(args, DeletePaymentArgs);
        await container.get(PaymentService).delete(paymentId);
        return { content: [{ type: 'text', text: 'OK' }] };
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
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
 * from [billing.ck](../contracts/billing.ck#L201)
 */
@Injectable()
export class CreateCredentialMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_credential',
        description: 'store a credential',
        inputSchema: z.toJSONSchema(CreateCredentialArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Credential, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body } = await parseAndValidate(args, CreateCredentialArgs);
        const result = await container.get(PaymentService).createCredential(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/**
 * from [billing.ck](../contracts/billing.ck#L214)
 */
@Injectable()
export class CreateSessionMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'create_session',
        description: 'open a session',
        inputSchema: z.toJSONSchema(CreateSessionArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Session, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body } = await parseAndValidate(args, CreateSessionArgs);
        const result = await container.get(PaymentService).createSession(body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
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
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
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
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
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

/** Add this file's tools to the tool map. */
export function registerBillingMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('search_payments', container.get(SearchPaymentsMcpTool));
    map.set('get_refund', container.get(GetRefundMcpTool));
    map.set('search_payments_by_date', container.get(SearchPaymentsByDateMcpTool));
    map.set('search_payments_scoped', container.get(SearchPaymentsScopedMcpTool));
    map.set('save_scoped_search', container.get(SaveScopedSearchMcpTool));
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerBillingMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('create_payment', container.get(CreatePaymentMcpTool));
    map.set('list_payments', container.get(ListPaymentsMcpTool));
    map.set('search_payments', container.get(SearchPaymentsMcpTool));
    map.set('create_payments', container.get(CreatePaymentsMcpTool));
    map.set('get_payment', container.get(GetPaymentMcpTool));
    map.set('update_payment_with_form', container.get(UpdatePaymentWithFormMcpTool));
    map.set('delete_payment', container.get(DeletePaymentMcpTool));
    map.set('get_refund', container.get(GetRefundMcpTool));
    map.set('create_credential', container.get(CreateCredentialMcpTool));
    map.set('create_session', container.get(CreateSessionMcpTool));
    map.set('search_payments_by_date', container.get(SearchPaymentsByDateMcpTool));
    map.set('save_scoped_search', container.get(SaveScopedSearchMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerBillingMcpToolClasses(registry: Registry): void {
    registry.register(CreatePaymentMcpTool).useClass(CreatePaymentMcpTool).asSingleton();
    registry.register(ListPaymentsMcpTool).useClass(ListPaymentsMcpTool).asSingleton();
    registry.register(SearchPaymentsMcpTool).useClass(SearchPaymentsMcpTool).asSingleton();
    registry.register(CreatePaymentsMcpTool).useClass(CreatePaymentsMcpTool).asSingleton();
    registry.register(GetPaymentMcpTool).useClass(GetPaymentMcpTool).asSingleton();
    registry.register(UpdatePaymentWithFormMcpTool).useClass(UpdatePaymentWithFormMcpTool).asSingleton();
    registry.register(DeletePaymentMcpTool).useClass(DeletePaymentMcpTool).asSingleton();
    registry.register(GetRefundMcpTool).useClass(GetRefundMcpTool).asSingleton();
    registry.register(CreateCredentialMcpTool).useClass(CreateCredentialMcpTool).asSingleton();
    registry.register(CreateSessionMcpTool).useClass(CreateSessionMcpTool).asSingleton();
    registry.register(SearchPaymentsByDateMcpTool).useClass(SearchPaymentsByDateMcpTool).asSingleton();
    registry.register(SearchPaymentsScopedMcpTool).useClass(SearchPaymentsScopedMcpTool).asSingleton();
    registry.register(SaveScopedSearchMcpTool).useClass(SaveScopedSearchMcpTool).asSingleton();
}
