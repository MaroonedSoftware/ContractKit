# @contractkit/core

## 0.27.0

### Minor Changes

- aea5e21: Move the `.ck` printer into core, so the language has exactly one

    `.ck` had two printers: the prettier plugin's `printCk` and a hand-rolled one inside
    `openapi-to-ck`. Only the prettier copy was covered by the round-trip tests that the grammar
    checklist points at, so the other silently fell behind the grammar — it ignored `hasBlock` and
    the `(documented)` response modifier, could not emit `mcp:`, `plugins:`, `name:`, `override`,
    `format(output=)` or options-level header globals, and emitted source that does not parse for a
    regex containing `/` or an enum value carrying both quote styles.

    `printCk` now lives in `@contractkit/core` next to `parseCk` and is exported from it. The
    prettier plugin re-exports it unchanged, and `openapi-to-ck`'s `astToCk` is a thin adapter over
    it, so all of the above now print correctly.

    Three printing fixes come with the move, all of which affect `pnpm format` on existing files:
    - A regex containing `/` prints as `regex="…"` instead of an unterminated regex literal.
    - A string containing `"` prints single-quoted; one carrying both quote styles is degraded
      rather than emitted unparseable (use the new `isUnquotable` to warn before printing).
    - A description containing newlines is flattened when it prints as a trailing `# …` comment,
      instead of leaking the remainder as raw source.

    Files containing any of these currently cannot round-trip at all, so this is a fix rather than a
    break. `openapi-to-ck` output changes shape in two ways: model descriptions now print as a
    doc-comment block above the `contract` rather than as a trailing comment, and scalar constraints
    use the canonical `len=` / positional `format` spellings.

## 0.26.1

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.

## 0.26.0

### Minor Changes

- ab69718: Stop the formatter deleting comments in and around a `security { }` block, and keep the trailing newline at end of file.

    The identical bug in `response { }` was fixed in 0.14.0; this position was not covered. `SecurityBody_fields` skipped standalone comments outright, so a `#` run inside a security block never reached the AST and `pnpm format` deleted it with no warning — exactly the prose that records _why_ a policy floor sits where it does. Three more positions failed the same way and now round-trip:
    - a comment run above a body key in an operation body (the common case being a note above the `security:` key, or above `security: none`, explaining why a verb overrides the file's floor);
    - a comment run above a verb that also carries its own inline `# ...` doc comment — the inline comment won and the run above it was discarded;
    - a comment left after the last key in an operation body, before the closing brace.

    `SecurityPolicyLine` and `SecuritySignatureLine` no longer take a trailing `comment?`. Whitespace skipping in an Ohm syntactic rule crosses newlines, so that optional comment swallowed a standalone comment written on the _next_ line and re-emitted it as the policy's inline description — turning a note to the next contract author into generated SDK documentation. `SecurityBody_fields` now collects every comment and decides which one is inline by comparing source lines, the same way `FieldList` already does.

    The same newline-crossing optional appeared on `ModelBody_alias`, where it was worse: it claimed the doc comment of the _next_ declaration. `contract Status: enum(a, b)` followed by a documented contract either lost that doc comment outright, or silently re-filed it as `Status`'s own description — which then flowed into generated SDK docs describing the wrong type. Declaration-level comments are now items in `Root` (`DeclItem`) rather than a `comment*` prefix on each declaration, so their placement is decided where the previous declaration's end line is known: same line as the declaration above → its inline description; directly above the next one → its doc comment; otherwise a standalone block. A comment after the last declaration in a file used to be a parse error and is now kept as `CkRootNode.trailingComments`.

    Two field positions were lost the same way. A comment on a nested object's opening brace (`rp: { # The relying party`) was offered to the first field _inside_ the object and dropped when that field had its own comment; it now belongs to the field owning the brace. A trailing comment on a field whose type wraps over several lines — `enum(\n  a,\n  b\n) # note` — was compared against the line the field _started_ on, so it was filed as a standalone comment for the next field; it now compares against the line the field ends on.

    `SecurityFields` gains `leadingComments` / `trailingComments`, `OpOperationNode` gains `bodyLeadingComments`, `bodyTrailingComments`, and `leadingComments`, and `CkRootNode` gains `trailingComments`. All are optional and additive, so codegen plugins are unaffected.

    ### `#` where it is not a comment

    `nameText` ended a name at any `#`, so `name: Generate C# client` silently became `Generate C` and the rest vanished with no diagnostic. It now ends at whitespace-then-`#`, matching `optionsRawChar` — a bare `#` is data, and only ` #` opens a comment. That makes the two unquoted-text positions in the language consistent with each other. The TextMate `name-decl` pattern captured the whole rest of the line, colouring a trailing comment as part of the name; it now stops at the same boundary the parser does.

    Note that a `name:` containing a bare `#` now parses to its full text, and the SDK method name is derived from `name:` — so a contract that was silently relying on the truncated value will see that method renamed. Only a name with a `#` in it is affected.

    Separately, the prettier plugin trimmed the printed source and returned it without re-adding a terminator, so every formatted `.ck` file lost its trailing newline — fighting any editor or lint rule that wants one. The plugin now has end-to-end tests that go through prettier itself rather than calling `printCk` directly, which is the layer where that slipped through.

## 0.25.0

### Minor Changes

- 85d7566: Let an operation emit more than one status, and a status serve more than one content type.

    A status code could previously declare only one mime — the parser warned `Duplicate response body` and dropped the rest — and the generated router pinned both `ctx.status` and `ctx.type` to whichever response happened to be listed first with a body. An endpoint serving several formats had to declare one lying mime and let browsers sniff, and a service had no way to say which status it produced.

    A status now holds every declared `mime: Type` line (`OpResponseNode.bodies`). When there is more than one, the service picks at runtime and the router sets `ctx.type` from the returned `contentType`. When an operation produces more than one status, the service returns a union discriminated on `status` and the handler switches on it, so each status writes only its own headers, mime and body. Both SDKs mirror the router: the TypeScript and Python clients return a matching union, report which mime came back, and pass the non-2xx statuses they expect to the shared fetch so a declared `304` no longer surfaces as an error. `SdkError` now takes a body type parameter, and each operation exports a `…ErrorBody` alias for the statuses that stay on the throw path.

    Which statuses the service produces is derived from the declaration: **a status is emitted if it has a block, or is 2xx.** An empty block (`304: {}`) says the service returns that status carrying nothing; a bare `304:` says it is documented and something else produces it. `404(documented): { … }` is the one modifier, forcing a block-carrying status back out.

    Two long-standing bugs in the same area go with it. The formatter deleted any comment written inside a `response` block — above a status code, above a mime line, above a `headers:` block, or before a closing brace — so `pnpm format` silently threw away the notes explaining why a contract looks the way it does; all four positions now round-trip. And the generated router declared a `_ZodBinary` helper for a binary _response_ body, which is a plain `Buffer` annotation with no schema behind it, leaving an unused const that tripped `noUnusedLocals` downstream; helpers are now chosen from the code that was actually generated, the same way imports already were.

    **If you are already on a pre-release version, two things change under you.** A contract that declares a body on an error status — `404: { application/json: Problem }` alongside a `200` — now returns it from the service instead of throwing, and the SDK return type becomes a union; add `(documented)` to that status to keep the previous behaviour. Contracts whose error statuses are bodyless (`400:`, `404:`) are unaffected. Anything reading the AST directly should move from `OpResponseNode.contentType`/`bodyType` to `bodies`, which replaces them.

- 90d19ee: Allow a comment above `options`, and a trailing comment on an options entry.

    A `#` comment above a `contract` or `operation` has always been fine, but one above the `options` keyword was a parse error — a file header is a natural thing to write, and writing it broke the build. `OptionsBlock` now owns the leading `comment*`. It lives there rather than on `Root` deliberately: on `Root` its greedy match would swallow the doc comment above a `contract` in a file that has no options block at all.

    A trailing comment on a `keys`/`services` entry was worse than unsupported: it was swallowed into the value, and because an unquoted value ends at the first `}`, a comment containing one — `# interpolated as {{area}}` — closed the block early and silently mis-parsed the rest of the file. The value now ends at whitespace-then-`#`, and the comment is retained so the formatter round-trips it. A `#` with no space before it still belongs to the value, so the unquoted subpath form (`PetService: #modules/pet/pet.service.js`) is unaffected.

    The TextMate grammar had the matching gap: its unquoted-value pattern accepted identifiers only, so an unquoted subpath fell through to the comment pattern and was coloured as though the parser ignored it.

    An unquoted value also stays unquoted. The AST now records which entries were authored bare, so the formatter reproduces that choice instead of normalizing every value to the quoted form. The flag is formatting-only — both forms parse to the same string — and a value that could not be read back bare is still quoted, which covers values built programmatically rather than parsed.

## 0.24.0

### Minor Changes

- 23e4beb: Fix the formatter rewriting `.ck` files it should have left alone. Running Prettier on a contract folded standalone `#` comment blocks into a trailing comment on the following declaration (`# ─── Pet endpoints ───` became `operation /pet: { # ─── Pet endpoints ───`), reordered operation body keys into a canonical order, dropped blank lines between operations, and expanded single-line response bodies like `200: { application/json: Pet }` onto three lines. An inline contract comment (`contract Pet: { # A pet`) was also attributed to the first field, so it printed twice.

    The parser now records the author's layout alongside the semantics — comment placement (`leadingComments`, `descriptionInline`), operation body key order (`keyOrder`), blank lines (`blankLineBefore`), and single-line response blocks (`inline`) — and the printer reproduces it. A `#` comment separated from the declaration below it by a blank line is a standalone divider rather than a doc comment; one written directly above is a doc comment and is emitted above the declaration, not on its header line.

    Comments may now also sit directly inside an `options { ... }` block, between its sub-blocks, where the grammar previously rejected them.

    These AST fields are additive and optional; codegen plugins ignore them.

## 0.23.0

### Minor Changes

- 2bf01f1: Preserve trailing comments and options-block (`keys`/`services`) comments through the formatter via new `trailingComments`/`optionsComments` AST fields; make options-level header defaulting idempotent (re-validating an already-merged AST no longer emits spurious override warnings); detect cross-base inheritance conflicts that flow through type-alias bases; and surface unexpected parse-time exceptions as diagnostics instead of silently dropping the file.

## 0.22.0

### Minor Changes

- 0d3b8e2: Add opt-in `sdk.scaffold` to the TypeScript plugin, which emits a starter `package.json` and `tsconfig.json` at the SDK `baseDir` so generated output is a buildable, publishable package. Dependencies are derived from the contracts (`zod` when `zod: true`; `luxon`/`@types/luxon` when a date/time scalar is used). Scaffold files are write-once: a new `ctx.emitFile(path, content, { ifAbsent: true })` option writes them only when absent and never overwrites or orphan-deletes them, so disabling `scaffold` or editing the files later is always safe.

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
