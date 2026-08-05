# Operations: MCP, response headers, header globals

## The `mcp` field

A per-HTTP-verb `mcp` field flags an operation for MCP tool/route generation. AST:
`OpOperationNode.mcp?: boolean | McpConfigNode` — the union is kept so prettier can
round-trip the exact source form. Default is `false`; `undefined`/`false` both mean "not
exposed", so test enablement with `Boolean(op.mcp)`.

- `mcp: true` / `mcp: false` — boolean form (parsed via `booleanLit`).
- `mcp: { name, title, description, hint }` — settings block. Text fields are quoted
  strings; `hint` is a bracket-less comma-separated token list (enum-style).

Hint tokens map to the four MCP annotation booleans on `McpConfigNode`
(`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) via positive/negative
pairs: `readOnly`/`nonReadOnly`, `idempotent`/`nonIdempotent`,
`destructive`/`nonDestructive`, `openWorld`/`closedWorld`. `hint:` is surface sugar —
consumers and validation only ever see the booleans.

Grammar: `McpDecl` (bool/block) plus `McpField`/`McpFieldValue` in `contractkit.ohm`.
Validation is inline in `semantics.ts` (`McpDecl_block` emits `diag?.error` for unknown
keys, value-kind mismatches, and unknown/conflicting/duplicate hint tokens); the
token→boolean table is `MCP_HINT_TOKENS`. Prettier reconstructs the block in canonical
field/token order in `print-operation.ts`.

**Only the TypeScript plugin consumes it**, via its `mcp` sub-config
(`packages/plugin-typescript/src/codegen-mcp.ts`). For every flagged op it emits an
`@maroonedsoftware/mcp` `@Injectable()` tool-handler class (`McpToolHandler`): the
`definition` is the MCP SDK `Tool` type, with `inputSchema`/`outputSchema` produced at
runtime from generated Zod schemas via `z.toJSONSchema(...)`, and the same Zod schema
reused for `parseAndValidate` in `handle`. The handler constructor-injects the op's
`service` and calls it. Output mirrors the Koa router: one `<filename>.mcp.ts` per op-root
(a cacheable unit) plus a `mcp.tools.ts` aggregator assembling the DI `McpToolHandlerMap`,
and an optional `mcp.router.ts`. The `@maroonedsoftware/mcp` runtime owns the JSON-RPC
lifecycle, sessions, Streamable HTTP transport, and auth. Python/OpenAPI/Markdown/Bruno do
not consume `op.mcp`.

## Response headers

A status code body can declare `headers: { name?: type, ... }` alongside
`application/json:`. AST: `OpResponseNode.headers?: OpResponseHeaderNode[]`.

- **OpenAPI** emits `headers:` under the response with `schema`/`required`/`description`.
- **TS SDK** changes the return shape to `Promise<{ data: T; headers: { ... } }>` (or
  `Promise<{ headers: ... }>` for void). Header property names are camelCased via
  `headerNameToProperty` in `ts-render.ts`.
- **TS router** types the service result as `{ body, headers }` and emits
  `ctx.set(name, String(value))` per header, guarded by `!== undefined` for optional ones.
- **Python SDK** emits a per-method `TypedDict` (e.g. `GetTransferHeaders`) at module top
  and returns `tuple[T, GetTransferHeaders]` (or just the TypedDict for void). The base
  client gains `_fetch_with_headers`, which lowercases response-header keys for
  case-insensitive lookup.
- **Bruno** emits `isDefined` runtime assertions for each required response header on the
  asserted status code, and lists all declared headers in the request's `docs` block.
- **Markdown** renders a "Response headers" table.

Header values are always read as strings (TS `Headers.get(...) ?? undefined`, Python the
lowercased response-header dict). Declaring a non-`string` type is allowed but generates
no runtime parsing or coercion.

## Options-level header globals

A file's `options` block can declare `request: { headers: {...} }` and
`response: { headers: {...} }` to apply headers to every operation in the file. AST:
`OpRootNode.requestHeaders?` / `responseHeaders?: OpResponseHeaderNode[]`. The merge is
done by `apply-options-defaults.ts`, run by the CLI between `parseCk` and decompose.

- **Request headers** merge into every operation's request headers. An op-level header of
  the same name wins (override warning emitted). `headers: none` on the op
  (`OpOperationNode.requestHeadersOptOut`) skips the merge. An op using a
  referenced/compound type for headers skips the merge with a warning.
- **Response headers** merge into every status code on every operation, regardless of body
  presence or status class. Per-status `headers: none` (`OpResponseNode.headersOptOut`)
  skips that code. A per-status header of the same name wins.
- **Path-param collision**: a global request header colliding with a path parameter name
  on any route is an error.

Asymmetry to know about: TS server `ctx.set()` emission and TS SDK return shape only honor
headers on the **primary response** (first response with a body, falling back to the first
response). OpenAPI and Markdown iterate every status code, so options-level response
headers fully surface there. Treat global response headers as a spec/docs feature —
runtime emission for a non-primary status still requires inlining the header on that
status.
