---
'contractkit-vscode-extension': patch
---

The ContractKit Explorer view no longer appears in a workspace whose only `.ck` files or
`contractkit.config.json` sit in `dist/` or another gitignored folder. Workspace detection now
applies the same gitignore rules as the index.
