# Operations: modifiers, security, MCP, responses, streaming, headers

## Route modifiers and the security cascade

`operation(internal|deprecated)` and `get(internal|deprecated|public)` bind tightly to the keyword:
`operation (internal)` is a parse error. Explicit verb modifiers **replace** the route's rather than
merge, and `public` is stripped from the result, so `get(public)` is how one verb leaves an
`internal` route (`resolveModifiers` in `ast.ts`). Each generator decides what `internal` means
through its own `includeInternal`: the server router and Bruno default to including them, every SDK,
docs target and MCP default to leaving them out.

`security` cascades operation → route → file options, first one set wins (`resolveSecurity`).

| Declared | AST | Router guard |
| -------- | --- | ------------ |
| nothing anywhere | `undefined` | `requirePolicy()`, the runtime's default policy |
| `security: none` | `'none'` | none, the route is public |
| `security: { policy: none }` | `{ policy: false }` | `requirePolicy({ policy: false })`: a valid session, no policy |
| `security: { policy: name }` | `{ policy: 'name' }` | `requirePolicy({ policy: 'name' })` |

`route-guards.ts` renders these for both the routers and the MCP mount.

`signature:` inside a `security` block is a parse error that points at the operation-level form below.
The grammar matches it only so the diagnostic can name that form: a security block cascades from
options and routes and carries policy alone, while a signature belongs to one operation.

## Webhook signatures

`signature: KEY` on an operation, or `signature: { options: KEY, policy: name }`, becomes
`requireSignature('KEY', ...)` in the router. AST: `op.signature` and `op.signaturePolicy`, the latter
distinct from `security.policy`.

## Doc comments

A `#` comment is data, not trivia: it becomes a `description` or is kept in a `leadingComments` or
`trailingComments` field so the printer can put it back. An operation's description can sit above
the verb, inline on the verb line, or as the comment run opening the body, and flags on the node
record which (`descriptionInline`, `descriptionInBody`).

## The `mcp` field

A per-HTTP-verb `mcp` field controls MCP exposure. AST:
`OpOperationNode.mcp?: boolean | 'exclude' | McpConfigNode`. The union is kept so prettier can
round-trip the exact source form. Default is not exposed. Test tool exposure with `isMcpTool(op)`
from core, **not** `Boolean(op.mcp)`, because `'exclude'` is truthy.

- `mcp: true` / `mcp: false`: boolean form (parsed via `booleanLit`).
- `mcp: exclude`: not a tool, and also kept out of the catalog of every operation (`mcp.catalog`) and,
  with `omitMcpExcluded`, out of the OpenAPI document.
- `mcp: { name, title, description, hint, ui }`: settings block. Text fields are quoted
  strings; `hint` is a bracket-less comma-separated token list (enum-style); `ui` is a quoted
  `ui://` URI naming the tool's MCP App, which the TypeScript plugin emits through `withMcpUi`. A
  non-`ui://` value is an error.

Hint tokens map to the four MCP annotation booleans on `McpConfigNode`
(`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`) via positive/negative
pairs: `readOnly`/`nonReadOnly`, `idempotent`/`nonIdempotent`,
`destructive`/`nonDestructive`, `openWorld`/`closedWorld`. `hint:` is surface sugar:
consumers and validation only ever see the booleans.

Read hints through `resolveMcpHints(op)` (`mcp-hints.ts`), not off the node. It takes each hint from
the block and otherwise from the method (`MCP_METHOD_HINTS`): `GET` is read-only and idempotent,
`PUT` idempotent, `DELETE` destructive, `openWorldHint` always `false`. Both the tool annotations and
OpenAPI's `operationSecurity` read/write choice go through it, so they cannot disagree.

Grammar: `McpDecl` (bool/exclude/block) plus `McpField`/`McpFieldValue` in `contractkit.ohm`.
Validation is inline in `semantics.ts` (`McpDecl_block` emits `diag?.error` for unknown
keys, value-kind mismatches, and unknown/conflicting/duplicate hint tokens); the
token→boolean table is `MCP_HINT_TOKENS`. Prettier reconstructs the block in canonical
field/token order in `print-operation.ts`.

**Two plugins consume it.** `plugin-docs`' OpenAPI target reads `mcp: exclude` and the resolved hints
(`omitMcpExcluded`, `operationSecurity`, `mcpAnnotations`). The TypeScript plugin generates the tools,
through its `mcp` sub-config (`packages/plugin-typescript/src/codegen-mcp.ts`). For every flagged op
it emits an `@maroonedsoftware/mcp` `@Injectable()` tool-handler class (`McpToolHandler`): the
`definition` is the MCP SDK `Tool` type, with `inputSchema`/`outputSchema` produced at
runtime from generated Zod schemas via `z.toJSONSchema(...)`, and the same Zod schema
reused for `parseAndValidate` in `handle`. Output mirrors the Koa router: one `<filename>.mcp.ts` per
op-root (a cacheable unit) plus a `mcp.tools.ts` aggregator and an optional `mcp.router.ts`. The
aggregator exports `registerMcpTools(container)`, which builds and returns the DI
`McpToolHandlerMap`, and `registerMcpToolClasses(registry)`. The `@maroonedsoftware/mcp` runtime owns
the JSON-RPC lifecycle, sessions, Streamable HTTP transport, and authentication.

Every definition publishes all four annotations, so a client never falls back to MCP's own defaults
(an unannotated tool reads as destructive and open-world), and carries the op's effective security
in `_meta['contractkit/security']`.

`mcp.resolve` picks when a handler gets its service and `PolicyService`: `boot` (default) injects them
once in the constructor, `perCall` resolves them in `handle()` from the request's scoped container,
so a request-scoped service sees the caller's actor.

`mcp.catalog: true` also generates a handler for every operation a tool can serve, flagged or not,
gathered by `registerMcpCatalog(container)` into an `McpToolCatalog`. Nothing lists it in `tools/list`;
a meta tool looks handlers up by name. `isCatalogOperation` leaves out `mcp: exclude`, a multipart
request, a non-JSON response and a `format()` result. `assertUniqueToolNames` throws when two
operations derive the same tool name.

A streaming operation is never a tool, since a tool returns one result. `planTools` skips it and
the plugin warns if it was marked `mcp`.

MCP requires `structuredContent` to be an object, so `resultShape` reports a list as `{ items }` and a
scalar or nullable result as `{ value }`, with `outputSchema` wrapped to match. A result in an envelope
(several statuses, response headers, several mimes) that isn't already an object schema is text only.

The args schema reuses the router's renderers with the all-files model map
(`McpCodegenOptions.models`), so an intersection with a `format()` member is built from that
member's object exactly as the router builds it, and a tool parses the keys its HTTP route
parses. A model ref stays its own schema, a pipe included. `inputSchema` is
`z.toJSONSchema(Args, { unrepresentable: 'any', io: 'input' })`: on the default output side a
pipe renders as `{}`, since JSON Schema cannot describe its transform, and a client learned
nothing of the `from_date` the args require. The output side has no such fix, so a tool whose
result compiles to a `format()` pipe publishes no `outputSchema` (`resultShape`, `outputSchemaExpr`)
and returns text content only, with no `structuredContent`. MCP requires `outputSchema` to be
`type: 'object'`, and an SDK client rejects the whole `tools/list` over one that is not.

Each handler also enforces the op's effective `security` with `requireMcpPolicy` before it
parses its arguments — a tool is another way to invoke the operation, not a way around its
gate. An op declaring nothing takes `MFA_SATISFIED_POLICY`, the same gate its HTTP route
gets; `security: none` emits no check. The route guard in `mcp.router.ts` closes the mount
rather than the individual tools, so it defaults to a session check and drops to nothing
when any exposed tool is public; `mcp.security` overrides it.

Python, Kotlin, Swift, C#, Markdown, Mintlify's pages, Docusaurus and Bruno do not read `op.mcp`.

## Which responses the service produces

Every generator derives its shape from three helpers in `packages/contractkit/src/response-sets.ts`,
so the router and the clients cannot disagree about a contract. Each takes an operation node and
nothing else, which is what lets options-level responses merge upstream later without touching
any consumer.

- `emittedResponses(op)` — what the service returns and the router writes.
- `observableResponses(op)` — what a client receives as a value: every emitted response, plus
  every non-emitted one below 400 (a `304` from conditional-GET middleware is a real outcome).
- `thrownResponses(op)` — the rest, i.e. non-emitted 4xx/5xx. Their bodies are the error contract.

The derivation is one line: **a status is emitted if it has a block, or is 2xx.** Braces say
"this is what the response consists of", which only the service can produce; a bare status says
it is documented and something else produces it. Bare bodyless 2xx (`204:`) is the one carve-out.
`OpResponseNode.hasBlock` records whether braces were written, so `304: {}` and `304:` mean
different things and the prettier plugin must not normalize one into the other.

`404(documented): { … }` (`OpResponseNode.emit`) is the only override, forcing a
block-carrying status back out. The reverse direction is structural — add `{}`. A `(documented)`
that changes nothing warns from `validateRefs`, deliberately *not* the parser: once options-level
responses exist, the same marker on the same status becomes a real override of a global.

All three helpers return status-sorted arrays so generated output does not depend on whether a
response was authored locally or merged in.

## Several content types for one status

`OpResponseNode.bodies: OpResponseBodyNode[]` holds every `mime: Type` line for a status, in
source order. The grammar always allowed repeats under a status; only the semantics action used
to reject them. Repeating the *same* mime is still a warning.

With more than one body, the service picks the mime at runtime: the router types the result with
a `contentType` field and assigns `ctx.type = result.contentType`. Bodies that are structurally
equal (`bodyTypesStructurallyEqual`) collapse to one member with a union of mime literals;
differing bodies produce one member per mime so `contentType` and `body` stay correlated.

## Content-type categories

Mimes are stored lowercase. `classifyContentType` (`content-type.ts`) is what generators branch on,
for request and response bodies alike:

- `json`: `application/json` or any `+json` suffix. Full schema validation.
- `urlencoded`, `multipart`: form-style request bodies. `validateOp` warns on nested shapes in a
  urlencoded body, which don't round-trip through form encoding.
- `event-stream`: `text/event-stream`, below. Checked before the `text/` rule on purpose.
- `text`: any other `text/*`. A raw string, no schema enforcement.
- `binary`: everything else (`application/octet-stream`, `image/*`). Opaque bytes.

## Server-Sent Events

A `text/event-stream` body makes the operation a stream, and its declared type is the schema of one
event's JSON `data`, usually a discriminated union. `eventStreamResponse(op)` finds it.
Full user-facing treatment: `docs/language.md`.

`validateOp` (`validateEventStream`) **errors** unless the operation has the one shape every generator
can render:

- the stream is on a single status, a 2xx, not `(documented)`, and is that status's only body;
- no other status is observable: other outcomes are thrown, so they are bare errors (`404:`) or marked
  `(documented)`. `404: { application/json: X }` beside a stream is an error;
- the event type is not `binary`;
- a request body is never `text/event-stream`.

What each generator does:

- **TS SDK**: returns `Promise<SseEventStream<Event>>`, an async iterable, with a trailing optional
  `requestOptions: { signal?, lastEventId? }`. `parseSse` in `sdk-options.ts` applies the same revivers
  a buffered body gets, and publishes an event's id only once that event is dispatched.
- **TS router**: the service takes an `EventSink<Event>` and `lastEventId` after its usual arguments
  rather than returning a body. `streamEvents` (emitted from `codegen-operation.ts`) opens the response
  on the service's first use of the sink, so the service can still throw an error status first, and
  closes it when the method settles. `validateResponses` does not apply. The framework seam is
  `response.openSse()`, `request.lastEventId` and `streamSetup()`: Koa uses `openSseStream`, Fastify
  uses `openSseReply`, marks the route `config: { contractkit: { stream: true } }`, and aborts its
  streams from a `preClose` hook.
- **OpenAPI**: the media type's schema is the event schema, with `x-contractkit-stream: true`, because
  OpenAPI 3.1 cannot say a schema is per event. Markdown and Docusaurus label it a stream of the event
  type. Mintlify reads the OpenAPI document.
- **Python, Kotlin, Swift, C#**: do not stream. Each warns through `ctx.warn` and reads the response as
  one string.
- **MCP**: no tool, see above.

## Response headers

A status code body can declare `headers: { name?: type, ... }` alongside
`application/json:`. AST: `OpResponseNode.headers?: OpResponseHeaderNode[]`.

- **OpenAPI** emits `headers:` under the response with `schema`/`required`/`description`.
- **TS SDK** changes the return shape to `Promise<{ data: T; headers: { ... } }>` (or
  `Promise<{ headers: ... }>` for void). Header property names are camelCased via
  `headerNameToProperty` in `ts-render.ts`.
- **TS router** types the service result as `{ body, headers }` and emits
  a header write per header through the framework adapter (`ctx.set` on Koa), guarded by
  `!== undefined` for optional ones. The value is `String(value)`, except a `date` or `time`, written
  with `toFormat()` in its contract format (`headerValueExpr`).
- **Python SDK** emits a per-method `TypedDict` (e.g. `GetTransferHeaders`, or
  `GetTransferResponseHeaders` when the operation also declares inline request headers, which take that
  name) at module top and returns `tuple[T, GetTransferHeaders]` (or just the TypedDict for void). The base
  client gains `_fetch_with_headers`, which lowercases response-header keys for
  case-insensitive lookup.
- **Bruno** emits `isDefined` runtime assertions for each required response header on the
  asserted status code, and lists all declared headers in the request's `docs` block.
- **Markdown** renders a "Response headers" table.

A declared type **is** parsed on read. The TS SDK's `sdkHeaderEntry` converts each scalar: `int` and
`number` through `Number`, `boolean` as `=== 'true'`, `bigint` through `parseBigIntHeader`, temporals
through Luxon. Python's `pyHeaderReader` does the same with `int()`, `UUID()`, `date.fromisoformat()`
and so on. Both **throw at codegen** on a type they cannot read from a header (a model, `decimal`), and
their accepted lists differ, so a `duration` header passes the TS SDK and throws in Python.

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

Asymmetry to know about: OpenAPI and Markdown iterate every status code, while the TS server
emits `ctx.set()` only for statuses in `emittedResponses` and the clients only for those in
`observableResponses`. A global header on a status that is documented rather than emitted
therefore surfaces in the spec and the docs but has no runtime counterpart — nothing generated
writes it, because nothing generated writes that status.
