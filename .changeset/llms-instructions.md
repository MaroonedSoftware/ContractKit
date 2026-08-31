---
'@contractkit/core': patch
'@contractkit/cli': patch
'@contractkit/plugin-typescript': patch
'@contractkit/plugin-python': patch
'@contractkit/plugin-openapi': patch
'@contractkit/plugin-markdown': patch
'@contractkit/plugin-bruno': patch
'@contractkit/openapi-to-ck': patch
'@contractkit/explorer-ui': patch
'@contractkit/prettier-plugin': patch
---

Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.
