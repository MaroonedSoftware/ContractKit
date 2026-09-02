# @contractkit/plugin-markdown

> **Deprecated.** Use [`@contractkit/plugin-docs`](../plugin-docs) and its `markdown` target instead.
> This package is now a thin re-export of that target and will be removed in a future major.

## Migrating

Replace the plugin entry in `contractkit.config.json`:

```json
{
    "plugins": {
        "@contractkit/plugin-docs": {
            "markdown": { "baseDir": "docs/", "output": "api-reference.md" }
        }
    }
}
```

Every option keeps its name and meaning, and the rendered document is unchanged.

Moving also lets you add the `openapi` and `mintlify` targets in the same block.

## Why

The OpenAPI, Markdown and Mintlify generators all read the same AST and had drifted apart in how
they titled and grouped the same endpoint. They now share one implementation in `plugin-docs`,
which also means one package to install and one block to configure.

## License

MIT
