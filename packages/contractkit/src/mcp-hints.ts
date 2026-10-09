import type { HttpMethod, OpOperationNode } from './ast.js';

/** The four MCP tool annotation hints, in the order a tool definition lists them. */
export const MCP_HINT_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

/** One MCP tool annotation hint. */
export type McpHintKey = (typeof MCP_HINT_KEYS)[number];

/** All four hints, each resolved to a boolean. */
export type McpHints = Record<McpHintKey, boolean>;

/**
 * The hints an operation's method implies, for each one its `mcp` block leaves unset: a `GET` reads
 * and can be repeated, a `PUT` can be repeated, a `DELETE` destroys. A tool calls the app's own
 * service in-process, so none reaches an open world of external entities.
 */
export const MCP_METHOD_HINTS: Record<HttpMethod, McpHints> = {
    get: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    put: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    delete: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    post: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    patch: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
};

/**
 * All four hints for an operation: each the contract's `hint:` where its `mcp` block sets one, and
 * the method's otherwise. Every generator that reports whether an operation reads or writes (an MCP
 * tool's annotations, an OpenAPI document's scopes) resolves it here, so they cannot disagree.
 */
export function resolveMcpHints(op: OpOperationNode): McpHints {
    const cfg = typeof op.mcp === 'object' ? op.mcp : undefined;
    const defaults = MCP_METHOD_HINTS[op.method];
    return {
        readOnlyHint: cfg?.readOnlyHint ?? defaults.readOnlyHint,
        destructiveHint: cfg?.destructiveHint ?? defaults.destructiveHint,
        idempotentHint: cfg?.idempotentHint ?? defaults.idempotentHint,
        openWorldHint: cfg?.openWorldHint ?? defaults.openWorldHint,
    };
}
