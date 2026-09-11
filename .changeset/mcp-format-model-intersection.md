---
'@contractkit/plugin-typescript': patch
---

An MCP tool whose arguments intersect a `format()` model now compiles, in its `query:`, `headers:` and `params:` arguments, its request body and its inline output schema.

The router already built an intersection such as `query: SnakeFilter & { q: string }` from the member's own object, `SnakeFilter.in`, but the MCP generator still emitted `SnakeFilter.extend({ q: z.string() })` and `Plain.extend(SnakeFilter.shape)`, which failed `tsc` with TS2339 because a `format()` schema is a `ZodPipe`. The `.mcp.ts` file now builds the same chain as the router, so a tool's args parse `from_date` and `q` and the service receives `{ fromDate, q }`, exactly as it does over HTTP.

A tools file's cache fingerprint now covers the `format()` models it reads through and the keys each one parses, so a model in another `.ck` file gaining a field regenerates the tools that intersect it.
