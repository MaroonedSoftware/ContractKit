import { describe, expect, it } from 'vitest';
import { MCP_METHOD_HINTS, resolveMcpHints } from '../src/mcp-hints.js';
import type { HttpMethod, OpOperationNode } from '../src/ast.js';

const op = (method: HttpMethod, mcp?: OpOperationNode['mcp']): OpOperationNode => ({ method, mcp, responses: [], loc: { file: 'x.ck', line: 1 } });

describe('resolveMcpHints', () => {
    it('takes every hint from the method when the operation sets none', () => {
        expect(resolveMcpHints(op('get'))).toEqual(MCP_METHOD_HINTS.get);
        expect(resolveMcpHints(op('delete', true))).toEqual(MCP_METHOD_HINTS.delete);
        expect(resolveMcpHints(op('post', 'exclude'))).toEqual(MCP_METHOD_HINTS.post);
    });

    it('lets the mcp block override one hint and keeps the method’s for the rest', () => {
        // A POST that only searches is read-only, but still not idempotent by its method.
        const hints = resolveMcpHints(op('post', { readOnlyHint: true, loc: { file: 'x.ck', line: 1 } }));
        expect(hints).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    });
});
