---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
---

Add `ui` to the `mcp` settings block: `mcp: { ui: "ui://app/view" }` links an operation's tool to an MCP App (MCP UI), the `ui://` resource a host renders with its results. Anything but a `ui://` URI is a compile-time error. The TypeScript plugin wraps that tool's definition in `@maroonedsoftware/mcp`'s `withMcpUi` (0.7 or later), which sets `_meta.ui.resourceUri` beside the security entry.
