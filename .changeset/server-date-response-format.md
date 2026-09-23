---
'@contractkit/plugin-typescript': patch
---

The generated router now writes `date` and `time` response fields in their contract format, so the SDK can read them back.

A router wrote the service result with `ctx.body = result` (or `reply.send(result)`), and the framework's `JSON.stringify` called luxon's `DateTime.toJSON()` on every `date` and `time` field. That is a full ISO timestamp such as `2026-09-23T00:00:00.000Z`. The generated SDK reads a `date` with `DateTime.fromFormat(v, 'yyyy-MM-dd')`, so it threw `does not match format yyyy-MM-dd` and the whole call failed. The SDKs for other languages read the same format and failed the same way. A `date` or `time` response header was written with `String()`, which gave the same timestamp.

Server type files now declare a `serializeX()` beside each contract whose response shape holds a `date` or `time`, directly, through a base, or through a contract it references. It takes what the service returns (`XOutput` where `format(output=)` re-keys it) and returns a copy with each `date` and `time` written by `toFormat()` in the field's format (`yyyy-MM-dd` and `HH:mm:ss` by default). The router writes a JSON response body through it: `serializeX(result)`, `result.map(serializeX)` for an array, or a function in the router file for an inline object, a record or a bare `date`. It composes with `validateResponses` (the parsed value is serialized) and with `bigIntReplacer` (serialized, then stringified). A non-JSON mime is written as the service built it. A `date` or `time` response header is written with `toFormat()`. MCP tool results go through the same serializers, for an operation that answers with one status.

A router calls a contract's serializer only when `server.output.types` is generated, since a hand-written types file declares none. Bodies with no `date` or `time` in them, `decimal` values, and every request are generated unchanged.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `13`, so an existing incremental cache regenerates its routers and type files.
