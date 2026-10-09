---
'@contractkit/core': minor
'@contractkit/plugin-typescript': patch
---

Move the MCP annotation hints into core as `resolveMcpHints(op)` (with `MCP_HINT_KEYS` and `MCP_METHOD_HINTS`), so every generator that reports whether an operation reads or writes resolves it the same way. The generated MCP tool annotations are unchanged.
