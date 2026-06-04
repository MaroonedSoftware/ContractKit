# @contractkit/cli

## 0.10.1

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0
    - @contractkit/openapi-to-ck@0.9.0

## 0.10.0

### Minor Changes

- bdebb9c: cli: orphan cleanup + compiler-version cache invalidation; core: shared validateProject
    - The CLI now deletes generated files whose owning plugin no longer claims them (plugin removed from config, renamed, or output set shrank). Cleanup is best-effort and never deletes a file emitted under another plugin in the same run.
    - Build cache is now stamped with a fingerprint of `@contractkit/cli`, `@contractkit/core`, and every loaded plugin's package version. A mismatch on load drops the cache, so a `pnpm update` of any codegen-affecting package forces a full rebuild instead of silently serving stale `.ts`.
    - `computePluginFingerprint` accepts an optional plugin version so a single plugin upgrade invalidates only its slice when the top-level fingerprint changes are noisy.
    - New `validateProject` helper in `@contractkit/core` runs parse + options-defaults + variable-substitution + decompose + cross-file `validateRefs`/`validateInheritance`/`validateOp` in one call. Designed to be the single source of truth for CLI and LSP semantics. The LSP can adopt it incrementally to surface cross-file diagnostics in the editor; the CLI keeps its inline pipeline for now so plugin `validate`/`transform` hooks continue to run between normalization and validation.

- 90f45ff: LSP cross-file diagnostics; CLI compiler-fingerprint helpers extracted
    - VS Code extension now surfaces cross-file diagnostics (unknown model refs, multi-base inheritance conflicts, operation-validation errors, options-block normalization warnings) directly in the editor. A new `ProjectValidator` debounces project-wide validation across all parsed `.ck` ASTs and merges its results with per-document parse diagnostics. Multi-config workspaces are supported via the existing `WorkspaceConfigCache`.
    - `@contractkit/core` `validateProject` accepts a new optional `getKeysForFile(filePath)` resolver so each file can use its own `contractkit.config.json` fallback keys. Falls through to the workspace-wide `fallbackKeys` when the resolver returns `undefined`. Strictly additive.
    - `@contractkit/cli` extracts the compiler-fingerprint helpers (`readNearestPackageVersion`, `computeCompilerFingerprint`) into a dedicated module with direct unit-test coverage. No behavior change.

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0
    - @contractkit/openapi-to-ck@0.8.2

## 0.9.7

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0
    - @contractkit/openapi-to-ck@0.8.1

## 0.9.6

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0
    - @contractkit/openapi-to-ck@0.8.0

## 0.9.5

### Patch Changes

- 14deb80: Skip writing generated files when the on-disk content already matches. Avoids spurious mtime bumps that triggered downstream rebuild cascades (tsc watch, vite, etc.) for plugins that emit unconditional global files (TS SDK barrels, aggregator, Bruno collections). The compile summary now reports written vs. unchanged counts.

## 0.9.4

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0
    - @contractkit/openapi-to-ck@0.7.8

## 0.9.3

### Patch Changes

- 4ac6d4d: Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

    `PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

    After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0
    - @contractkit/openapi-to-ck@0.7.7

## 0.9.2

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1
    - @contractkit/openapi-to-ck@0.7.6

## 0.9.1

### Patch Changes

- 10ca07b: Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.
- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0
    - @contractkit/openapi-to-ck@0.7.5

## 0.9.0

### Minor Changes

- a9e9ec0: Replace per-operation `pluginFiles` with structured `pluginExtensions`. The `plugins:` block on an operation now accepts JSON-like values (string, number, boolean, null, object, array) so each plugin owns its own schema for its entry. `file://` URLs in any string position are resolved relative to the `.ck` source file before plugins run, and `http://` / `https://` URLs are fetched via GET. `op.pluginExtensions` carries the resolved tree; the raw form lives at `op.plugins`. The Bruno plugin now expects `{ template: "file://..." }` (was a bare path string) and ships a `validateBrunoExtension` hook that fails compilation on unknown fields or non-string `template`.

    Plugins can now implement `validateExtension(value)` on the `ContractKitPlugin` interface to surface compilation-time errors/warnings on their entry.

    All CLI caching is unified under `<rootDir>/.contractkit/cache/` via a new `CacheService` class: `build.json` for file/plugin hashes and `http/<sha256(url)>` for fetched HTTP response bodies. The `cache: string` config field is reinterpreted as a custom cache **directory** (was a custom build-cache filename); previous file paths under `.contractkit-cache` and `.contractkit-http-cache/` are abandoned. Add `.contractkit/` to `.gitignore`.

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0
    - @contractkit/openapi-to-ck@0.7.4

## 0.8.0

### Minor Changes

- d211c21: Allow `{{rootDir}}` and `{{configDir}}` inside plugin-config `keys` values.

    Values inside a plugin's `keys: { ... }` block in `contractkit.config.json` can now reference two built-in variables — `{{rootDir}}` and `{{configDir}}` — which the CLI substitutes at config load time with the resolved absolute paths. Useful when a plugin needs to point at an absolute path relative to the project root:

    ```json
    "@contractkit/plugin-bruno": {
        "keys": { "bruno": "{{rootDir}}/apps/api/contracts/bruno" }
    }
    ```

    Unknown built-ins emit a warning and substitute the literal string `undefined`. The `\{{name}}` escape works the same way it does inside `.ck` files.

## 0.7.0

### Minor Changes

- 7555412: Add `{{var}}` variable substitution in `.ck` files.

    Variables declared in a file's `options { keys: { ... } }` block can now be referenced from any string in the file as `{{name}}`. The CLI also collects a workspace-wide fallback map from each plugin entry's `options.keys` in `contractkit.config.json`, so an author can define a key once and use it across every `.ck` file.
    - `{{name}}` → resolved from `options.keys` first, then the plugin-config fallback. Unknown variables emit the literal string `undefined` and a warning (`Unknown variable '{{name}}'`).
    - `\{{name}}` → escapes the substitution; the literal characters `{{name}}` are emitted with no warning.

    Substitution runs as a post-parse normalization pass (after `applyOptionsDefaults`), so the prettier plugin still round-trips the source form.

    Example:

    ```
    options {
        keys: { bruno: "../../bruno" }
    }

    operation /auth/token: {
        post: {
            plugins: { bruno: "{{bruno}}/authentication/request.token.yml" }
            response: { 201: { application/json: AuthenticationToken } }
        }
    }
    ```

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0
    - @contractkit/openapi-to-ck@0.7.3

## 0.6.0

### Minor Changes

- 876696f: Add a `plugins` block to operations for attaching external files to individual code-generators.

    ```
    post: {
        plugins: {
            bruno: "request-token.yml"
        }
    }
    ```

    Each entry maps a plugin name to a path relative to the contract's `.ck` file. The CLI resolves the path before plugins run and exposes the file content on the AST as `op.pluginFiles[name]`; missing files emit a warning. Plugins keyed by their own `name` can read their entry to override or augment generated output. The raw paths remain on `op.plugins` for round-trip use cases (the prettier plugin and VS Code syntax highlighting consume the raw form).

### Patch Changes

- 876696f: Print all warnings and errors once at the end of the run, after file writes, instead of interleaving them with intermediate compilation phases. Errors that previously appeared twice (once at parse-time, once at the end) now appear only at the bottom of the output where they're easier to spot.
- Updated dependencies [876696f]
    - @contractkit/core@0.12.0
    - @contractkit/openapi-to-ck@0.7.2

## 0.5.1

### Patch Changes

- Updated dependencies [c9f2166]
- Updated dependencies [9269093]
    - @contractkit/core@0.11.0
    - @contractkit/openapi-to-ck@0.7.1

## 0.5.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0
    - @contractkit/openapi-to-ck@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0
    - @maroonedsoftware/openapi-to-ck@0.6.1

## 0.4.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0
    - @maroonedsoftware/openapi-to-ck@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [9b13e28]
    - @maroonedsoftware/openapi-to-ck@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0
    - @maroonedsoftware/openapi-to-ck@0.4.2

## 0.3.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0
    - @maroonedsoftware/openapi-to-ck@0.4.1

## 0.2.3

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/openapi-to-ck@0.4.0
    - @maroonedsoftware/contractkit@0.5.0

## 0.2.2

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/openapi-to-ck@0.3.0
    - @maroonedsoftware/contractkit@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0
    - @maroonedsoftware/openapi-to-ck@0.2.1

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
- Updated dependencies [6aa2aa0]
    - @contractkit/core@0.2.0
    - @contractkit/openapi-to-ck@0.2.0
