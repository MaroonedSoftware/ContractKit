---
'@contractkit/plugin-typescript': patch
---

A generated MCP tool whose operation takes a query now hands its service the parsed query when the caller sends none.

- A tool's `query` and `headers` arguments are optional, so a caller with nothing to filter need not send an empty object. The tool then passed `undefined` to a service that, through the router, has only ever been given the parsed object, since the router validates `ctx.query`, which is never absent. An operation whose service takes the query as a required parameter did not type-check once its tool was generated, which every catalog of a real API hits. An omitted query or headers is now parsed from `{}` against its own schema: its defaults apply, and a missing required field is the validation error the router gives.
- An inline query or headers block (`query: { limit?: int = 20 }`) kept each param's type but dropped its `?`, nullability and default, so every param was required in the tool's schema. Each param now carries the modifiers the router's inline block applies to it.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `16`, so an existing incremental cache regenerates its tools files.
