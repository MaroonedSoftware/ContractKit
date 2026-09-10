---
'contractkit-vscode-extension': patch
---

When a `.ck` file's nearest `contractkit.config.json` lists `patterns`, the workspace index keeps
the file only if one of those patterns matches it, the same set the CLI compiles. Test fixtures and
scratch contracts outside the patterns stop feeding cross-file diagnostics and the Explorer. Files
with no config, a config without `patterns`, or a config whose `rootDir` does not contain them fall
back to the gitignore rules. Files open in the editor stay indexed either way, and editing a config
re-indexes the workspace.
