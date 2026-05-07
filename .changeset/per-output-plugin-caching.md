---
'@contractkit/core': minor
'@contractkit/plugin-bruno': minor
'@contractkit/plugin-python': minor
'@contractkit/plugin-typescript': minor
'@contractkit/cli': patch
---

Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.
