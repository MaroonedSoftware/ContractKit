---
'@contractkit/plugin-typescript': minor
---

Every generated MCP tool definition now carries all four annotations and its operation's security.

A tool published only the hints its `mcp { hint: ... }` block set, and a tool declaring none published no `annotations` at all. MCP's defaults for a missing hint are `destructiveHint: true` and `openWorldHint: true`, so every `GET` read as destructive and open-world. Each hint the contract leaves unset now comes from the HTTP method: a `GET` is read-only and idempotent, a `PUT` idempotent, a `DELETE` destructive, and a `POST` or `PATCH` none of these. `openWorldHint` defaults to `false`, since a tool calls the app's own service in-process.

The definition's `_meta` also reports the operation's effective security under `contractkit/security`: `'none'`, or `{ policy }` with the policy the tool asserts (`false` for a bare session check, `MFA_SATISFIED_POLICY` for an operation that declares nothing). A meta tool searching the tools can filter by it.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `15`, so an existing incremental cache regenerates its tools files, including the `register<File>McpToolClasses` functions the aggregator now imports.
