---
'@contractkit/plugin-typescript': patch
---

An MCP tool now publishes its arguments as a caller sends them: `inputSchema` is `z.toJSONSchema(Args, { unrepresentable: 'any', io: 'input' })`.

A `format()` model's schema is a pipe ending in the transform that renames its keys, and JSON Schema cannot describe a transform, so on the default output side an argument such as `query: SnakeFilter` was published as `{}`. A client was told nothing about the `from_date` key the tool requires, and rejected with an unrecognized key when it sent `fromDate`. The input side is the object the pipe parses, so the published schema now names `from_date`, as the router's request does.

Every other argument is published as before, except that a field with a default is no longer listed in `required`, since a caller may leave it out.
