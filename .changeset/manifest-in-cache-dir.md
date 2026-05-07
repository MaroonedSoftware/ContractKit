---
'@contractkit/core': minor
'@contractkit/plugin-bruno': minor
'@contractkit/plugin-python': minor
'@contractkit/plugin-typescript': minor
'@contractkit/cli': patch
---

Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

`PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.
