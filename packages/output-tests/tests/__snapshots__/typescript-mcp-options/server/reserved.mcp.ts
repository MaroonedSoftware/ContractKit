// Auto-generated MCP tools
// generated from [reserved.ck](../contracts/reserved.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import { DateTime } from 'luxon';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { SeatService } from '#src/services/seat.service.js';
import { Note, Seat, SeatRef, serializeSeat } from './schemas/reserved.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const GetSeatArgs = z.object({ class: z.string(), query: z.object({ from: z.preprocess((val) => typeof val === 'string' ? DateTime.fromFormat(val, 'yyyy-MM-dd') : val, z.custom<DateTime>((val) => val instanceof DateTime && val.isValid, { message: 'Must be a date in format yyyy-MM-dd' })).optional(), in: z.string().optional(), pageSize: z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), z.number().int()).optional() }).optional(), headers: z.object({ from: z.string().optional() }).optional() });
const GetRowArgs = z.object({ params: SeatRef });
const PutNoteArgs = z.object({ body_: z.string(), body: Note });

/**
 * from [reserved.ck](../contracts/reserved.ck#L48)
 */
@Injectable()
export class GetSeatMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_seat',
        description: 'fetch one seat',
        inputSchema: z.toJSONSchema(GetSeatArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Seat, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { class: class_, query = await parseAndValidate({}, GetSeatArgs.shape.query.unwrap()), headers = await parseAndValidate({}, GetSeatArgs.shape.headers.unwrap()) } = await parseAndValidate(args, GetSeatArgs);
        const result = await container.get(SeatService).getSeat(class_, query, headers);
        const resultJson = JSON.stringify({ ...result, body: serializeSeat(result.body) });
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [reserved.ck](../contracts/reserved.ck#L74)
 */
@Injectable()
export class GetRowMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'get_row',
        description: 'fetch a row by its seat class',
        inputSchema: z.toJSONSchema(GetRowArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Seat, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { params } = await parseAndValidate(args, GetRowArgs);
        const result = await container.get(SeatService).getRow(params);
        const resultJson = JSON.stringify(serializeSeat(result));
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [reserved.ck](../contracts/reserved.ck#L89)
 */
@Injectable()
export class PutNoteMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'put_note',
        description: 'replace a note',
        inputSchema: z.toJSONSchema(PutNoteArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Note, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { body_, body } = await parseAndValidate(args, PutNoteArgs);
        const result = await container.get(SeatService).putNote(body_, body);
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    }
}

/** Add this file's tools to the tool map. */
export function registerReservedMcpTools(map: McpToolHandlerMap, container: Container): void {
    map.set('get_seat', container.get(GetSeatMcpTool));
    map.set('put_note', container.get(PutNoteMcpTool));
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerReservedMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('get_seat', container.get(GetSeatMcpTool));
    map.set('get_row', container.get(GetRowMcpTool));
    map.set('put_note', container.get(PutNoteMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerReservedMcpToolClasses(registry: Registry): void {
    registry.register(GetSeatMcpTool).useClass(GetSeatMcpTool).asSingleton();
    registry.register(GetRowMcpTool).useClass(GetRowMcpTool).asSingleton();
    registry.register(PutNoteMcpTool).useClass(PutNoteMcpTool).asSingleton();
}
