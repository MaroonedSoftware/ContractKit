---
'@contractkit/plugin-typescript': minor
---

`mcp.catalog: true` generates an unlisted MCP handler for every operation.

Only `mcp`-flagged operations got a tool handler, so a meta tool that searches the whole API (and calls what it finds) had nothing to call for the rest. With `catalog` on, every operation a tool can serve gets a handler, and `mcp.tools.ts` gains `registerMcpCatalog(container)`, which builds an `McpToolCatalog`: a `McpToolHandlerMap` under its own token, kept apart from the flagged tools that `registerMcpTools` still returns. Nothing lists the catalog in `tools/list`.

An operation declaring `mcp: exclude` stays out, and so does one a tool cannot serve: a multipart request, a response that is not JSON, or a `format()` result. Two operations deriving the same tool name are a generation error, since one would replace the other in the map.

Each tools file now exports `register<File>McpTools` only when it has flagged operations, and `register<File>McpCatalog` only when it has catalog ones.
