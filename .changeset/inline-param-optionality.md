---
'@contractkit/plugin-typescript': minor
'@contractkit/plugin-openapi': minor
---

Honour the optionality an inline `query:` or `headers:` block declares, in the router, the SDK and the OpenAPI document.

All three read the same `OpParamNode.optional`, and all three ignored it. The router validated every inline param as required, the SDK typed every one optional, and OpenAPI marked every non-path parameter `required: false`. So for a contract saying

```
query: { limit?: int = 20, cursor: string }
headers: { api-key?: string, x-tenant: string }
```

the SDK let you omit a `cursor` the router would then reject, while typing `limit` as something you had to think about even though it has a default; and the published spec disagreed with both.

Now:

- **Router** — the param schema carries the same modifier chain a model field does, via the shared `applyFieldModifiers`. `limit` becomes `.default(20)`, `api-key` becomes `.optional()`. The hand-rolled query-array preprocess is gone too, delegating to `renderQueryType`, which already had that rule.
- **SDK** — a field is optional only when the contract says so, either with `?` or by carrying a default. The whole argument is optional only when every field is, since a caller cannot omit an object that must supply something.
- **OpenAPI** — `required` follows the contract for query and header parameters, matching what the `inlineObject` branch already did. The two `$ref` branches are unchanged: a whole-model param source has no per-field optionality to read.

**Python is deliberately excluded.** It hardcodes `optional: true` on query and headers, and has the same ordering constraint as a `SyntaxError` rather than a type error. Permissive is safe; changing it belongs with the work that gives inline query params a `TypedDict`.

### What this breaks

**SDK call sites stop compiling when an argument becomes required.** The old signature was wrong in both directions at once, so this surfaces two different latent bugs: calls that omitted a value the router demanded, and required fields typed as optional so nothing made you pass them.

**Requests omitting a non-optional inline param now get a 400.** They were already being rejected by the router; what changes is that the SDK and the spec now say so. To find the affected surface, grep your contracts for inline `query:` and `headers:` blocks whose fields lack a `?` — that set is exactly the delta.

One case only becomes reachable now: parameter order is path, body, query, then customHeaders, so an all-optional `query:` in front of an all-required `headers:` would emit `async m(query?: Q, customHeaders: H)`, which is `TS1016`. A normalisation pass clears `optional` on every argument before the last required one, which is the only fix that keeps the positional order call sites depend on.
