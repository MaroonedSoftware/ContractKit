# @contractkit/prettier-plugin-contractkit

## 0.14.6

### Patch Changes

- Updated dependencies [74b8a28]
    - @contractkit/core@0.28.2

## 0.14.5

### Patch Changes

- ffb2ec6: Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

    Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.

- Updated dependencies [ffb2ec6]
    - @contractkit/core@0.28.1

## 0.14.4

### Patch Changes

- Updated dependencies [e102a2c]
    - @contractkit/core@0.28.0

## 0.14.3

### Patch Changes

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

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.14.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.14.1

### Patch Changes

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

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.14.0

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

### Patch Changes

- Updated dependencies [85d7566]
- Updated dependencies [90d19ee]
    - @contractkit/core@0.25.0

## 0.13.0

### Minor Changes

- 23e4beb: Fix the formatter rewriting `.ck` files it should have left alone. Running Prettier on a contract folded standalone `#` comment blocks into a trailing comment on the following declaration (`# ─── Pet endpoints ───` became `operation /pet: { # ─── Pet endpoints ───`), reordered operation body keys into a canonical order, dropped blank lines between operations, and expanded single-line response bodies like `200: { application/json: Pet }` onto three lines. An inline contract comment (`contract Pet: { # A pet`) was also attributed to the first field, so it printed twice.

    The parser now records the author's layout alongside the semantics — comment placement (`leadingComments`, `descriptionInline`), operation body key order (`keyOrder`), blank lines (`blankLineBefore`), and single-line response blocks (`inline`) — and the printer reproduces it. A `#` comment separated from the declaration below it by a blank line is a standalone divider rather than a doc comment; one written directly above is a doc comment and is emitted above the declaration, not on its header line.

    Comments may now also sit directly inside an `options { ... }` block, between its sub-blocks, where the grammar previously rejected them.

    These AST fields are additive and optional; codegen plugins ignore them.

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.12.2

### Patch Changes

- 2bf01f1: Preserve trailing comments instead of dropping them on format: a comment as the last line of a contract/model body, an operation/route body, an inline object type, or an options `keys`/`services` block now round-trips.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.12.1

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.12.0

### Minor Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.11.2

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.11.1

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.11.0

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

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0

## 0.10.0

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

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.9.6

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.9.5

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.9.4

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.9.3

### Patch Changes

- a9e9ec0: Replace per-operation `pluginFiles` with structured `pluginExtensions`. The `plugins:` block on an operation now accepts JSON-like values (string, number, boolean, null, object, array) so each plugin owns its own schema for its entry. `file://` URLs in any string position are resolved relative to the `.ck` source file before plugins run, and `http://` / `https://` URLs are fetched via GET. `op.pluginExtensions` carries the resolved tree; the raw form lives at `op.plugins`. The Bruno plugin now expects `{ template: "file://..." }` (was a bare path string) and ships a `validateBrunoExtension` hook that fails compilation on unknown fields or non-string `template`.

    Plugins can now implement `validateExtension(value)` on the `ContractKitPlugin` interface to surface compilation-time errors/warnings on their entry.

    All CLI caching is unified under `<rootDir>/.contractkit/cache/` via a new `CacheService` class: `build.json` for file/plugin hashes and `http/<sha256(url)>` for fetched HTTP response bodies. The `cache: string` config field is reinterpreted as a custom cache **directory** (was a custom build-cache filename); previous file paths under `.contractkit-cache` and `.contractkit-http-cache/` are abandoned. Add `.contractkit/` to `.gitignore`.

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.9.2

### Patch Changes

- 1be6771: Fix prettier printer to re-quote enum values that contain spaces or other non-identifier characters, preventing round-trip parse failures for values like `"Sole Proprietorship"`.

## 0.9.1

### Patch Changes

- 7555412: Round-trip path-like values in `options.keys` and `options.services` correctly.

    Values that aren't plain identifiers (paths with slashes, values starting with `.` or `#`, values containing spaces, etc.) are now consistently double-quoted on output. Previously only values starting with `#` or containing spaces were quoted, so a value like `"../../bruno"` lost its quotes on round-trip and re-parsed as a different shape.

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.9.0

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

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.8.1

### Patch Changes

- 9269093: chore: update dependencies across multiple projects

    This commit updates various dependencies in the package.json files for several projects, including:
    - Upgraded `@changesets/cli`, `@types/node`, `@vitest/coverage-v8`, `eslint`, `prettier`, `turbo`, and `typescript` to their latest versions.
    - Updated `@types/vscode`, `@vscode/vsce`, and `esbuild` in the vscode extension.
    - Adjusted `@scalar/openapi-parser` and `yaml` in the openapi-to-ck package.
    - Enhanced ESLint and TypeScript configurations in the config-eslint package.

    These updates improve compatibility and maintainability across the codebase.

- Updated dependencies [c9f2166]
    - @contractkit/core@0.11.0

## 0.8.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.7.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.6.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.5.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.4.1

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.4.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.3.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
