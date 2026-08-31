# @contractkit/openapi-to-ck

## 0.11.0

### Minor Changes

- 7b3b270: Import 4xx/5xx responses that declare a body as `(documented)`

    **This changes the output of re-running the importer.** OpenAPI cannot say whether a handler
    _returns_ a status or merely documents it, but `.ck` distinguishes the two and every generator
    depends on the answer. Every declared status used to be imported as service-produced: a spec
    declaring `404: {application/json: Error}` became `404: { … }`, which made the generated Koa
    handler responsible for returning the 404 and made the TypeScript and Python SDKs hand it back
    as a value rather than throwing.

    A bodied 4xx or 5xx now imports as `404(documented): { … }` — the body is the error contract, the
    SDK throws it as an `SdkError`, and the service is not responsible for producing it. 2xx and 3xx
    are unchanged, as is a bare bodyless error status (marking those would be redundant, and core
    warns about it).

    Pass `errorResponses: 'emitted'`, or `--error-responses emitted` on the command line, to restore
    the previous behaviour.

    Also in this release:
    - `$ref`s to `#/components/parameters`, `requestBodies`, `responses` and `headers` are now
      resolved. A `$ref`'d parameter previously reached the printer with no name and emitted
      `undefined: string` — which parses, so nothing reported it. Anything still unresolvable is
      warned about and skipped instead of emitted.
    - Every generated file is re-parsed before it is returned, and a file that does not parse is
      reported as a warning rather than written out silently.
    - The command line gained `--no-comments`, which was documented but never implemented.

    Coverage, in the same release:
    - `name:` is imported from an operation's `summary`, which used to be dropped entirely.
    - Request bodies keep any RFC 6838 `type/subtype` content type. The importer previously allowed
      only JSON, form-urlencoded and multipart, silently discarding everything else, even though the
      grammar has accepted any mime since vendor MIME support landed.
    - `format: duration` maps to the `duration` scalar, and the `idn-email`, `uri-reference`, `iri`
      and `iri-reference` formats map alongside their existing counterparts.
    - `additionalProperties: true` imports as `mode(loose)`.
    - A spec-level `security` requirement now applies to operations that do not override it; it was
      collected and never read, so a globally unsecured spec imported as secured.
    - Constructs with no `.ck` equivalent are warned about rather than dropped in silence: `head`,
      `options` and `trace` operations, non-numeric response keys (`default`, `4XX`), cookie
      parameters, unparameterised mime types, and the `exclusiveMinimum`, `exclusiveMaximum`,
      `multipleOf` and `uniqueItems` constraints. A `4XX` response key previously became status `4`,
      because `parseInt` stops at the first non-digit.

### Patch Changes

- fd62377: Fix tag splitting, schema-name sanitization, and stale docs
    - A model reached only from a `params`, `query` or `headers` block was filed under `shared.ck`
      instead of its own tag's file. `collectParamSourceRefs` was written against the shape
      `ParamSource` had before it became a tagged union, so only the `ref` case still worked — and
      only by coincidence, since it happens to look like a model reference.
    - A schema whose name starts with a digit (`3DModel`) produced an identifier the parser rejects.
      It is now prefixed with `_`.
    - `@scalar/openapi-parser` has been removed from the dependencies. It was never imported; the
      normalization is hand-written, despite a comment claiming otherwise.
    - The README documented an `openapi-to-ck --input …` command that does not exist. The command is
      `import-openapi <spec-path>`, and the docs now cover `--no-comments`, `--error-responses`, and
      what the converter warns about rather than dropping silently.

- 841af6e: Only wrap a circular reference in `lazy()` where it breaks a real cycle

    `lazy()` exists so that a reference between two contracts that depend on each other can be
    deferred: `topoSortModels` emits dependencies before dependents and can only fall back to source
    order for a cycle. A reference from an operation — a response body, request body, parameter, or
    response header — names a model the generated module has already imported and fully evaluated,
    so there is no cycle to break.

    Every reference to a self-referential schema used to be wrapped, so importing a spec with a tree-
    shaped model produced `application/json: lazy(Widget)` on every body mentioning it. References
    inside a contract, including one extracted from an inline body schema, still wrap as before.

    Also fixed: a model extracted from an inline request or response body schema was referenced by
    the generated operation and never emitted, because the extracted-model list was read before path
    conversion filled it. Any spec with an inline (non-`$ref`) body schema produced a contract
    pointing at something that did not exist. The post-conversion self-check now runs reference
    validation as well as parsing, which is what caught it — a reference to an undefined contract is
    perfectly good syntax, so parsing alone could not.

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

## 0.10.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.10.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.10.0

### Minor Changes

- 85d7566: Let an operation emit more than one status, and a status serve more than one content type.

    A status code could previously declare only one mime — the parser warned `Duplicate response body` and dropped the rest — and the generated router pinned both `ctx.status` and `ctx.type` to whichever response happened to be listed first with a body. An endpoint serving several formats had to declare one lying mime and let browsers sniff, and a service had no way to say which status it produced.

    A status now holds every declared `mime: Type` line (`OpResponseNode.bodies`). When there is more than one, the service picks at runtime and the router sets `ctx.type` from the returned `contentType`. When an operation produces more than one status, the service returns a union discriminated on `status` and the handler switches on it, so each status writes only its own headers, mime and body. Both SDKs mirror the router: the TypeScript and Python clients return a matching union, report which mime came back, and pass the non-2xx statuses they expect to the shared fetch so a declared `304` no longer surfaces as an error. `SdkError` now takes a body type parameter, and each operation exports a `…ErrorBody` alias for the statuses that stay on the throw path.

    Which statuses the service produces is derived from the declaration: **a status is emitted if it has a block, or is 2xx.** An empty block (`304: {}`) says the service returns that status carrying nothing; a bare `304:` says it is documented and something else produces it. `404(documented): { … }` is the one modifier, forcing a block-carrying status back out.

    Two long-standing bugs in the same area go with it. The formatter deleted any comment written inside a `response` block — above a status code, above a mime line, above a `headers:` block, or before a closing brace — so `pnpm format` silently threw away the notes explaining why a contract looks the way it does; all four positions now round-trip. And the generated router declared a `_ZodBinary` helper for a binary _response_ body, which is a plain `Buffer` annotation with no schema behind it, leaving an unused const that tripped `noUnusedLocals` downstream; helpers are now chosen from the code that was actually generated, the same way imports already were.

    **If you are already on a pre-release version, two things change under you.** A contract that declares a body on an error status — `404: { application/json: Problem }` alongside a `200` — now returns it from the service instead of throwing, and the SDK return type becomes a union; add `(documented)` to that status to keep the previous behaviour. Contracts whose error statuses are bodyless (`400:`, `404:`) are unaffected. Anything reading the AST directly should move from `OpResponseNode.contentType`/`bodyType` to `bodies`, which replaces them.

### Patch Changes

- Updated dependencies [85d7566]
- Updated dependencies [90d19ee]
    - @contractkit/core@0.25.0

## 0.9.3

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.9.2

### Patch Changes

- 2bf01f1: Flatten multi-line descriptions into single-line trailing comments and quote enum values containing spaces or other non-identifier characters, so `.ck` generated from real-world OpenAPI specs re-parses cleanly.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.9.1

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.9.0

### Minor Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.8.2

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.8.1

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.8.0

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

## 0.7.8

### Patch Changes

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

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.7.7

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.7.6

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.7.5

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.7.4

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.7.3

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.7.2

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.7.1

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

## 0.7.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.6.1

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.6.0

### Minor Changes

- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.5.0

### Minor Changes

- 9b13e28: Implement support for lifting response headers in OpenAPI 3.x and Swagger 2.0. Enhanced serialization of responses to include headers, updated normalization functions, and added tests to verify correct handling of response headers in generated output.

## 0.4.2

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

- 6aa2aa0: build fix

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
