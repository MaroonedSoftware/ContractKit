---
'contractkit-vscode-extension': patch
---

The workspace index now skips every path git ignores, not just `node_modules` and `.git`. It reads
`.gitignore` files at every level and `.git/info/exclude`, so `.ck` copies in `dist/`, `build/`, or
any other ignored folder no longer shadow the real contracts in go-to-definition, the Explorer, or
cross-file diagnostics. File-watcher events follow the same rules, so a `pnpm install` or a build
that writes `.ck` files into an ignored folder no longer pulls them into the index. Editing a
`.gitignore` re-indexes the workspace.
