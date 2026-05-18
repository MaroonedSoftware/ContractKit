---
'contractkit-vscode-extension': patch
'@contractkit/explorer-ui': patch
---

VS Code extension: fix Explorer view and preview panels going stale on file changes. The LSP client now synchronizes `.ck` and `contractkit.config.json` file events to the server, so edits made outside the active editor (saves to closed files, git operations, external tools) are picked up. The **Refresh Explorer** command now forces a full server-side re-walk of every `.ck` file on disk, and the refresh title-bar button is also exposed on the preview/overview panels.

Explorer UI: sort endpoints within each area on the Overview by route path then method, so the listing order is stable instead of reflecting parse order.
