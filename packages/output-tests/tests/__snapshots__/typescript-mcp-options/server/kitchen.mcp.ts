// Auto-generated MCP tools
// generated from [kitchen.ck](../contracts/kitchen.ck)
import { Injectable, type Container, type Registry } from 'injectkit';
import { z } from 'zod';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { requireMcpPolicy, type McpToolHandler, type McpToolHandlerMap, type McpToolContext } from '@maroonedsoftware/mcp';
import { PolicyService } from '@maroonedsoftware/policies';
import { MFA_SATISFIED_POLICY } from '@maroonedsoftware/authentication';
import { parseAndValidate } from '@maroonedsoftware/zod';
import { bigIntReplacer } from '@maroonedsoftware/utilities';
import { KitchenService } from '#src/services/kitchen.service.js';
import { Folder, Instrument, Named, SharedInput, Token, serializeFolder } from './schemas/kitchen.schema.js';

/** The request's scoped container, which a tool resolving per call reads its service and policies from. */
function requireMcpContainer(context: McpToolContext): Container {
    if (!context.container) {
        throw new Error(`MCP tool '${context.toolName}' needs the request container: pass \`container: ctx.container\` to createMcpRequestContext.`);
    }
    return context.container;
}

const ImportArgs = z.object({ folderId: z.uuid(), body: SharedInput });
const TouchFolderArgs = z.object({ folderId: z.uuid(), body: Named });
const ListTokensArgs = z.object({});

/**
 * from [kitchen.ck](../contracts/kitchen.ck#L139)
 */
@Injectable()
export class ImportMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'import',
        description: 'a method name that is a keyword in the target languages',
        inputSchema: z.toJSONSchema(ImportArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ value: Instrument }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { folderId, body } = await parseAndValidate(args, ImportArgs);
        const result = await container.get(KitchenService).replace(folderId, body);
        const resultJson = JSON.stringify({ value: result ?? null });
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [kitchen.ck](../contracts/kitchen.ck#L152)
 */
@Injectable()
export class TouchFolderMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'touch_folder',
        description: 'the one verb with no HttpMethod static of its own on every C# target framework',
        inputSchema: z.toJSONSchema(TouchFolderArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(Folder, { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const { folderId, body } = await parseAndValidate(args, TouchFolderArgs);
        const result = await container.get(KitchenService).touchFolder(folderId, body);
        const resultJson = JSON.stringify(serializeFolder(result), bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/**
 * from [kitchen.ck](../contracts/kitchen.ck#L211)
 */
@Injectable()
export class ListTokensMcpTool implements McpToolHandler {
    readonly definition: Tool = {
        name: 'list_tokens',
        inputSchema: z.toJSONSchema(ListTokensArgs, { unrepresentable: 'any', io: 'input' }) as Tool['inputSchema'],
        outputSchema: z.toJSONSchema(z.object({ items: z.array(Token) }), { unrepresentable: 'any' }) as Tool['outputSchema'],
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        _meta: { 'contractkit/security': { policy: MFA_SATISFIED_POLICY } },
    };

    async handle(_args: Record<string, unknown>, context: McpToolContext): Promise<CallToolResult> {
        const container = requireMcpContainer(context);
        await requireMcpPolicy(context, container.get(PolicyService), { policy: MFA_SATISFIED_POLICY });
        const result = await container.get(KitchenService).listTokens();
        const resultJson = JSON.stringify({ items: result }, bigIntReplacer);
        return { content: [{ type: 'text', text: resultJson }], structuredContent: JSON.parse(resultJson) };
    }
}

/** Add a handler for each of this file's operations to the catalog, unlisted in `tools/list`. */
export function registerKitchenMcpCatalog(map: McpToolHandlerMap, container: Container): void {
    map.set('import', container.get(ImportMcpTool));
    map.set('touch_folder', container.get(TouchFolderMcpTool));
    map.set('list_tokens', container.get(ListTokensMcpTool));
}

/** Register this file's tool classes on the registry, so the tool maps can resolve them. */
export function registerKitchenMcpToolClasses(registry: Registry): void {
    registry.register(ImportMcpTool).useClass(ImportMcpTool).asSingleton();
    registry.register(TouchFolderMcpTool).useClass(TouchFolderMcpTool).asSingleton();
    registry.register(ListTokensMcpTool).useClass(ListTokensMcpTool).asSingleton();
}
