---
'@contractkit/plugin-typescript': patch
---

An MCP tool whose result is a `format()` model no longer publishes an `outputSchema`, and returns its result as text content only.

MCP requires a tool's `outputSchema` to be `type: 'object'`. A `format()` model's schema is a pipe ending in the transform that renames its keys, which `z.toJSONSchema` renders as `{}`, so such a tool published an output schema with no `type` at all. A client built on the MCP SDK validates the whole `tools/list` result, and one such tool made it reject the list, hiding every tool on the server. This covers a model with its own or an inherited `format()`, and an alias of an intersection with a `format()` member. A tool returning any other model, or an inline object, publishes its output schema and `structuredContent` as before.
