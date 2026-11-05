---
'@contractkit/core': patch
'@contractkit/cli': patch
'@contractkit/plugin-typescript': patch
'@contractkit/plugin-kotlin': patch
'@contractkit/plugin-swift': patch
'@contractkit/plugin-csharp': patch
---

Correct shipped READMEs and `llms.txt` against current behaviour. `servicePathTemplate` examples use `{kebab}` (the template supports `{name}` and `{kebab}`, not `{module}`), the core README documents `op.pluginExtensions` and the real `generateTargets` inputs, and the plugin lists name Fastify and `@contractkit/plugin-docs`. `@contractkit/plugin-kotlin`, `@contractkit/plugin-swift` and `@contractkit/plugin-csharp` now ship an `llms.txt` like the other packages.
