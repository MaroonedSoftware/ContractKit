---
'@contractkit/core': minor
'@contractkit/cli': minor
'@contractkit/prettier-plugin': minor
'@contractkit/vscode-extension': minor
---

Add a `plugins` block to operations for attaching external files to individual code-generators.

```
post: {
    plugins: {
        bruno: "request-token.yml"
    }
}
```

Each entry maps a plugin name to a path relative to the contract's `.ck` file. The CLI resolves the path before plugins run and exposes the file content on the AST as `op.pluginFiles[name]`; missing files emit a warning. Plugins keyed by their own `name` can read their entry to override or augment generated output. The raw paths remain on `op.plugins` for round-trip use cases (the prettier plugin and VS Code syntax highlighting consume the raw form).
