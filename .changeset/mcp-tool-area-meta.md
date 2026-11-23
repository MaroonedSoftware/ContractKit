---
'@contractkit/plugin-typescript': minor
---

Generated MCP tools now report their file's area in `_meta`, under `'contractkit/area'`, beside the `'contractkit/security'` entry they already carry. The value is the `area` from the file's `options { keys }`, the same one that names its SDK client, and the entry is left out when a file names none. A meta tool over a large catalog can now group operations the way the API is organised (list the areas, then the operations in one) instead of only by keyword.
