---
'@contractkit/plugin-typescript': patch
---

A generated MCP tool whose result is a list, a scalar or `null` now returns valid structured content.

MCP requires `structuredContent` to be an object. A tool returning a list published no `outputSchema` and text only, and a ref to an alias of a list (`Payments: array(Payment)`) published an array `outputSchema`, which a client parsing `tools/list` rejects. A list is now reported as `{ items }` and anything else that isn't an object (a scalar, an enum, a union that may be `null`) as `{ value }`, with `outputSchema` wrapped to match. The text content carries the same JSON. A record and an intersection built by `.extend()` are now reported as the objects they are.

A `format()` result, and a result the service hands back in an envelope (several statuses, response headers), are still reported as text only.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `14`, so an existing incremental cache regenerates its tools files.
