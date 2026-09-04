import { SECURITY_NONE, type SecurityNode } from '@contractkit/core';
import { escapeSingleQuoted } from './ts-render.js';
import type { ServerFramework } from './server-framework.js';

/**
 * Render the `requirePolicy(...)` guard for an effective security value, or undefined when the
 * declaration is `security: none` and the route carries no policy guard at all.
 *
 * Shared by the operation routers and the MCP mount so the two cannot spell the same declaration
 * differently. The framework decides how a guard is written; this decides what its argument says.
 *
 * @param framework The adapter whose {@link ServerFramework.middleware} renders the call.
 * @param security The effective security, already resolved through `resolveSecurity`. `undefined`
 *   means the operation declared none and takes the runtime's default policy.
 */
export function policyGuard(framework: ServerFramework, security: SecurityNode | undefined): string | undefined {
    if (security === SECURITY_NONE) return undefined;

    const policy = security?.policy;
    // `false` is a declaration, not an absence: it means validate the session and skip the policy.
    const args = policy === undefined ? '' : policy === false ? '{ policy: false }' : `{ policy: '${escapeSingleQuoted(policy)}' }`;

    return framework.middleware.policy(args);
}

/**
 * Render the `requireSignature(...)` guard for a webhook signature declaration.
 *
 * @param framework The adapter whose {@link ServerFramework.middleware} renders the call.
 * @param options The HMAC scheme name — the `AppConfig` key the runtime reads its options from.
 * @param policy The signature-scoped policy from the block form, when the operation declared one.
 */
export function signatureGuard(framework: ServerFramework, options: string, policy?: string): string {
    const args =
        policy === undefined
            ? `'${escapeSingleQuoted(options)}'`
            : `'${escapeSingleQuoted(options)}', { policy: '${escapeSingleQuoted(policy)}' }`;

    return framework.middleware.signature(args);
}

/**
 * Collapse an effective security value to a string two declarations can be compared by.
 *
 * Comments live on {@link SecurityFields} alongside `policy`, and two operations gated the same way
 * but documented differently are the same gate, so only `policy` is folded in.
 */
export function canonicalSecurity(security: SecurityNode | undefined): string {
    if (security === undefined) return 'undeclared';
    if (security === SECURITY_NONE) return 'none';
    if (security.policy === undefined) return 'undeclared';

    return security.policy === false ? 'policy=false' : `policy=${security.policy}`;
}
