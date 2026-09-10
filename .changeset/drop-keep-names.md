---
'@contractkit/core': patch
'@contractkit/cli': patch
'@contractkit/prettier-plugin': patch
'@contractkit/explorer-ui': patch
'@contractkit/openapi-to-ck': patch
'@contractkit/plugin-bruno': patch
'@contractkit/plugin-csharp': patch
'@contractkit/plugin-docs': patch
'@contractkit/plugin-kotlin': patch
'@contractkit/plugin-python': patch
'@contractkit/plugin-swift': patch
'@contractkit/plugin-typescript': patch
---

Published builds no longer wrap every function in a `__name()` call, so a bundler can drop the
exports it does not use. The shared tsconfig enabled `emitDecoratorMetadata`, which made tsup compile
through swc with `keepNames` forced on, and nothing in the repo uses decorators. `@contractkit/core`
shrinks by about 7%, and anything that bundles it, the VS Code extension included, no longer
carries core functions it never calls.
