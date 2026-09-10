import type { OpOperationNode, OpRouteNode } from './ast.js';

/**
 * The TypeScript SDK's method name for an operation.
 *
 * The SDK generator and the docs' "SDK method" note both need this name, and they used to carry
 * their own copies of the rule. The docs' copy skipped the `name:` step, so an operation named
 * `Request token` was documented as `postAuthToken` while the SDK exposed `requestToken`. Living
 * here, the two cannot disagree again.
 *
 * Priority, first match wins:
 * 1. `sdk:`, verbatim.
 * 2. `name:`, camelCased: split on whitespace, `-` and `_`, e.g. `Request token` → `requestToken`.
 * 3. The verb followed by the path, e.g. `GET /users/{id}` → `getUsersById`.
 *
 * The other SDK generators (Python, C#, Kotlin, Swift) apply their own language's casing and do
 * not use this.
 */
export function deriveSdkMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return op.sdk;
    if (op.name) return nameToMethodName(op.name);
    return inferMethodName(op.method, route.path);
}

function nameToMethodName(name: string): string {
    const parts = name.split(/[\s\-_]+/).filter(Boolean);
    return parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

function inferMethodName(method: string, path: string): string {
    // Build a name from the path segments + method
    // e.g. GET /users/:id → getUsersById
    // e.g. POST /users → postUsers
    // e.g. DELETE /users/:id → deleteUsersById
    const segments = path.split('/').filter(s => s.length > 0);
    const parts: string[] = [method.toLowerCase()];

    for (const seg of segments) {
        if (seg.startsWith('{')) {
            // {id} → ById, {accountId} → ByAccountId
            const paramName = seg.slice(1, -1);
            parts.push('By' + paramName.charAt(0).toUpperCase() + paramName.slice(1));
        } else {
            // Regular segment — camelCase it
            const segParts = seg.split(/[.-]/).filter(Boolean);
            for (const sp of segParts) {
                parts.push(sp.charAt(0).toUpperCase() + sp.slice(1));
            }
        }
    }

    return parts.join('');
}
