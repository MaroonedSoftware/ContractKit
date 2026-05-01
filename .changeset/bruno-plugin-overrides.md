---
'@contractkit/plugin-bruno': minor
---

Add YAML override support to the Bruno plugin via per-operation plugin files and a new `overrideDir` config option.

Per-operation overrides: declare `plugins: { bruno: "override.yml" }` on an operation in a `.ck` file and the file's YAML content is deep-merged into the generated request file at codegen time. Objects recurse; arrays replace entirely.

Directory overrides: set `overrideDir` in the plugin config to a directory that mirrors the generated output structure. Any file found there is deep-merged into the matching generated file, enabling overrides for collection-level files (`opencollection.yml`, `environments/local.yml`) as well as individual request files.

The `mergePluginFile` function is now exported from `@contractkit/plugin-bruno` for use in custom tooling.
