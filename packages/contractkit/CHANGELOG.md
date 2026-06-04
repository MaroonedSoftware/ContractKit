# @contractkit/core

## 0.21.0

### Minor Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.

## 0.20.0

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

## 0.19.0

### Minor Changes

- a049895: Add `resolveEffectiveFields` and `buildModelIndex` to `@contractkit/core` for flattening multi-base inheritance into a fully-resolved field list. The explorer UI gains `renderSchemaTree` and `renderCodeSamples` for structured request/response rendering with deterministic curl + JSON examples, a two-column operation layout with a right rail, faker-seeded Try-It pre-fill, and a file-level preview page. The VS Code extension follows the active `.ck` editor with a new live preview panel, gates its tree view on detected ContractKit projects, and supports multiple preview tabs for pinned items.

## 0.18.0

### Minor Changes

- dd8197b: **Breaking:** Replace the `requireMfa: boolean` field in `security: { ... }` blocks with `policy: <ident|none>`, and switch the generated Koa router middleware from `requireSecurity` to ServerKit's new `requirePolicy`.

    The `security` declaration on operations, routes, and the file-level `options { security: { ... } }` block no longer accepts a `requireMfa:` line. The new field is `policy:` and takes a bare identifier (the named policy) or the keyword `none` to explicitly bypass policy enforcement. Existing `.ck` files that use `requireMfa:` will fail to parse.

    ```ck
    # Before
    security: {
        requireMfa: true
    }

    # After
    security: {
        policy: paymentsWrite
    }

    # Explicit bypass
    security: {
        policy: none
    }
    ```

    **`@contractkit/core`** — `SecurityFields` interface drops `requireMfa` / `requireMfaDescription` and adds `policy?: string | false` / `policyDescription?: string`. The grammar's `SecurityRequireMfaLine` is replaced by `SecurityPolicyLine` (`policyKw ":" (noneKw | identifier)`). `security: none` (the route-level public sentinel) is unchanged.

    **`@contractkit/plugin-typescript`** — Generated Koa routers now import `requirePolicy` from `@maroonedsoftware/koa` (previously `requireSecurity`) and emit `requirePolicy({ policy: 'name' })`, `requirePolicy({ policy: false })`, or bare `requirePolicy()`. Consumers must upgrade ServerKit alongside.

    **`@contractkit/prettier-plugin`** — Formats `policy: <name>` and `policy: none` lines inside security blocks. Files containing `requireMfa:` will no longer round-trip and will surface as parse errors.

    **`@contractkit/plugin-markdown`** — The "Security: authenticated" admonition now shows `policy: <name|none>` instead of `requireMfa: <bool>`.

    **`@contractkit/openapi-to-ck`** — Non-empty OpenAPI `security` requirements continue to collapse to an empty `security: {}` (authenticated, default policy); the serializer now emits `policy:` lines when the field is set.

    **`contractkit-vscode-extension`** — TextMate grammar highlights `policy:` inside the security block; LSP completion offers `policy` instead of `requireMfa`. Re-run `pnpm run vscode:install` to pick up the change.

## 0.17.0

### Minor Changes

- 79af33b: **Breaking:** Replace the `roles` field in `security: { ... }` blocks with `requireMfa: boolean`.

    The `security` declaration on operations, routes, and the file-level `options { security: { ... } }` block no longer accepts a `roles:` line. The new field is `requireMfa: true | false`. Existing `.ck` files that use `roles:` will fail to parse.

    ```ck
    # Before
    security: {
        roles: admin editor
    }

    # After
    security: {
        requireMfa: true
    }
    ```

    **`@contractkit/core`** — `SecurityFields` interface drops `roles` / `rolesDescription` and adds `requireMfa` / `requireMfaDescription`. The grammar's `SecurityRolesLine` is replaced by `SecurityRequireMfaLine` (`requireMfaKw ":" booleanLit`). `security: none` continues to work.

    **`@contractkit/plugin-typescript`** — Generated Koa routers now emit `requireSecurity({ requireMfa: <bool> })` when `requireMfa` is set, and bare `requireSecurity()` for unannotated routes (previously `requireSecurity({ roles: [...] })` / `requireSecurity({  })`). The generated code matches the updated serverkit `SecurityOptions = { requireMfa: boolean }` signature; consumers must upgrade serverkit alongside.

    **`@contractkit/prettier-plugin`** — Formats `requireMfa: true|false` lines inside security blocks. Files containing `roles:` will no longer round-trip and will surface as parse errors.

    **`@contractkit/plugin-markdown`** — The "Security: authenticated" admonition now shows `requireMfa: <bool>` instead of `roles: <list>`.

    **`@contractkit/openapi-to-ck`** — `convertSecurity` no longer extracts OpenAPI scopes into a `roles` list (those don't map onto MFA semantics). Any non-empty OpenAPI `security` requirement now collapses to `security: {}` (authenticated, no MFA flag).

## 0.16.0

### Minor Changes

- 4ac6d4d: Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

    `PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

    After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.

## 0.15.1

### Patch Changes

- 130d53b: Fix `stableStringify` (and therefore `hashFingerprint` / `runIncrementalCodegen`) crashing with "Do not know how to serialize a BigInt" when an AST payload contains a `bigint` default or literal. Bigints now serialize as a tagged string `"<bigint:VALUE>"` so they're stable in fingerprints and distinguishable from plain strings. `undefined` is also normalized to `null` so `{a: undefined}` and `{}` don't collide.

## 0.15.0

### Minor Changes

- 10ca07b: Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.

## 0.14.0

### Minor Changes

- a9e9ec0: Replace per-operation `pluginFiles` with structured `pluginExtensions`. The `plugins:` block on an operation now accepts JSON-like values (string, number, boolean, null, object, array) so each plugin owns its own schema for its entry. `file://` URLs in any string position are resolved relative to the `.ck` source file before plugins run, and `http://` / `https://` URLs are fetched via GET. `op.pluginExtensions` carries the resolved tree; the raw form lives at `op.plugins`. The Bruno plugin now expects `{ template: "file://..." }` (was a bare path string) and ships a `validateBrunoExtension` hook that fails compilation on unknown fields or non-string `template`.

    Plugins can now implement `validateExtension(value)` on the `ContractKitPlugin` interface to surface compilation-time errors/warnings on their entry.

    All CLI caching is unified under `<rootDir>/.contractkit/cache/` via a new `CacheService` class: `build.json` for file/plugin hashes and `http/<sha256(url)>` for fetched HTTP response bodies. The `cache: string` config field is reinterpreted as a custom cache **directory** (was a custom build-cache filename); previous file paths under `.contractkit-cache` and `.contractkit-http-cache/` are abandoned. Add `.contractkit/` to `.gitignore`.

## 0.13.0

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

## 0.12.0

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

## 0.11.0

### Minor Changes

- c9f2166: Path parameters now accept the full type-expression syntax — including constraint args (`int(min=1, max=5)`), enums (`enum(available, pending, sold)`), regex strings, and unions — instead of only a bare type identifier.

## 0.10.0

### Minor Changes

- bbee232: prep for public release

## 0.9.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

## 0.8.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

## 0.7.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

## 0.6.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

## 0.5.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

## 0.4.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org
