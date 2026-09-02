# @contractkit/plugin-openapi

> **Deprecated.** Use [`@contractkit/plugin-docs`](../plugin-docs) and its `openapi` target instead.
> This package is now a thin re-export of that target and will be removed in a future major.

## Migrating

Replace the plugin entry in `contractkit.config.json`:

```json
{
    "plugins": {
        "@contractkit/plugin-docs": {
            "openapi": {
                "baseDir": "docs/api/",
                "output": "openapi.yaml",
                "info": { "title": "Acme API", "version": "1.0.0" },
                "securitySchemes": { "bearerAuth": { "type": "http", "scheme": "bearer" } }
            }
        }
    }
}
```

Every option keeps its name and meaning. The output is unchanged.

Moving also lets you add the `markdown` and `mintlify` targets in the same block, and when the
Mintlify target writes into the same folder it references this spec rather than emitting a second
copy.

## Why

The OpenAPI, Markdown and Mintlify generators all read the same AST and had drifted apart in how
they titled and grouped the same endpoint. They now share one implementation in `plugin-docs`,
which also means one package to install and one block to configure.

## License

MIT
