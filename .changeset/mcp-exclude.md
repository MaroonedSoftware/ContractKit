---
'@contractkit/core': minor
'@contractkit/plugin-typescript': patch
---

`mcp: exclude` keeps an operation out of an MCP catalog.

An operation can now declare `mcp: exclude`. Like `mcp: false` it is no MCP tool, and it also marks the operation as one a catalog of every operation leaves out. The AST carries it as `op.mcp === MCP_EXCLUDE` (`'exclude'`), and the printer and the VS Code grammar round-trip it. Since the value is truthy, test tool exposure with the new `isMcpTool(op)` rather than `Boolean(op.mcp)`.
