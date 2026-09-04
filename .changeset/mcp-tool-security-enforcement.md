---
'@contractkit/plugin-typescript': minor
---

Generated MCP output now enforces the security its contracts declare.

Each tool handler opens with `requireMcpPolicy` for its operation's effective security, cascaded
operation → route → file, before it parses any arguments. Previously an operation's `security` was
ignored on the MCP path entirely: the guard on `POST /mcp` closes the mount, but one `tools/call`
reaches every registered tool, so a tool generated from an operation whose HTTP route required a
policy was callable by anyone who cleared the mount. An operation declaring nothing takes
`MFA_SATISFIED_POLICY`, the same gate `requirePolicy()` applies to its route; `{ policy: false }`
validates the session only; `security: none` emits no check and injects no `PolicyService`.

The mount guard changes from `requireSignature('mcp', { policy: MCP_AUTH_POLICY })` to
`requirePolicy({ policy: false })`, or to no guard when any exposed tool is `security: none`. The old
guard read the `Authorization` header, which `authenticationMiddleware` / `authenticationPlugin`
delete once they have resolved it, so on any server running the default stack it denied every
request; upstream has deprecated that whole header-reading path. The mount can be no stricter than
the most permissive tool behind it without locking that tool out. That is safe because each tool now
asserts its own policy: the mount only decides whether an unauthenticated caller is turned away at
the door or inside the tool.

New `mcp.security` overrides the mount guard, in the same vocabulary a `.ck` operation uses:
`"none"`, `{ "policy": false }`, or `{ "policy": "name" }`. It configures the mount only and cannot
weaken a tool below what its contract declares. The router also passes `authenticationSession` into
`createMcpRequestContext`, which is what makes the session readable inside a handler.

Requires `@maroonedsoftware/mcp` 0.3.0 or later, for `requireMcpPolicy`, and
`@maroonedsoftware/authentication` 4.31.0 or later, for `MFA_SATISFIED_POLICY`. Generated tool files
now import from `@maroonedsoftware/policies` (0.6.9 or later, for `PolicyService`) and
`@maroonedsoftware/authentication` when any tool runs a check.

Two pieces of wiring belong in your app. First, a `bearer` scheme handler that authenticates the MCP
caller: ServerKit's `McpAuthenticationHandler`, chained with your JWT handler through
`ChainedAuthenticationHandler`. Second, if static-token callers must reach tools whose operations
declare no security, a re-registration of `MFA_SATISFIED_POLICY` accepting a session whose
`claims.mcp` is true. The session `McpAuthenticationHandler` mints carries no factors, so the default
gate rejects it.
