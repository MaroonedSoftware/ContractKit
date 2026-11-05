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
 * 2. `name:`, camelCased: split on anything that cannot be part of an identifier, as well as `_`, so
 *    `Request token` → `requestToken` and `Generate C# client` → `generateCClient`. `name:` is free
 *    text, so a leading digit gets a `_` (`2fa setup` → `_2faSetup`), and a name with no identifier
 *    characters at all is skipped.
 * 3. The verb followed by the path, e.g. `GET /users/{id}` → `getUsersById`.
 *
 * The other SDK generators (Python, C#, Kotlin, Swift) apply their own language's casing and do
 * not use this.
 */
export function deriveSdkMethodName(op: OpOperationNode, route: OpRouteNode): string {
    if (op.sdk) return op.sdk;
    return (op.name && nameToMethodName(op.name)) || inferMethodName(op.method, route.path);
}

function nameToMethodName(name: string): string {
    const parts = name.split(/[^\p{ID_Continue}$]+|_+/u).filter(Boolean);
    const camel = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join('');
    return camel === '' || /^[\p{ID_Start}$]/u.test(camel) ? camel : `_${camel}`;
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
