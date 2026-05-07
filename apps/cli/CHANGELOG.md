# @contractkit/cli

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
