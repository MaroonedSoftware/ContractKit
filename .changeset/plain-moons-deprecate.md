---
'@contractkit/plugin-openapi': major
'@contractkit/plugin-markdown': major
---

Deprecated in favour of `@contractkit/plugin-docs`, which now emits these outputs as its `openapi`
and `markdown` targets.

Both packages are reduced to thin re-exports and keep working: every export, option name and
generated file is unchanged, so existing configs continue to resolve. They will be removed in a
future major.

To migrate, move the entry under `@contractkit/plugin-docs` and keep the options as they are:

```json
"@contractkit/plugin-docs": {
    "openapi": { "baseDir": "docs/api/", "output": "openapi.yaml" },
    "markdown": { "baseDir": "docs/", "output": "api-reference.md" }
}
```

`npm deprecate` must be run manually against both packages after this release publishes.
