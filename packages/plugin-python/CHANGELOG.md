# @contractkit/contractkit-plugin-python

## 0.13.2

### Patch Changes

- Updated dependencies [74b8a28]
    - @contractkit/core@0.28.2

## 0.13.1

### Patch Changes

- ffb2ec6: Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

    Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.

- Updated dependencies [ffb2ec6]
    - @contractkit/core@0.28.1

## 0.13.0

### Minor Changes

- e102a2c: Add a `decimal` scalar, for money and anything else that has to be exact

    `number` compiles to `z.coerce.number()` — an IEEE-754 double. Anything monetary has to be exact,
    so contracts either lied about their types or routed the value through `string` by hand. `decimal`
    gives the language a type for it:

    ```
    contract Payslip: {
        gross: decimal(min=0, scale=2)
        rate: decimal
    }
    ```

    A decimal travels as a **quoted JSON string** (`{"gross": "1250.00"}`) and becomes a decimal.js
    `Decimal` — the same class Prisma hands you for a `Decimal` column, so a value moves between the
    two with no conversion. Python gets `decimal.Decimal`; OpenAPI gets `type: string, format: decimal`.

    A raw JSON number is **rejected**, not coerced. By the time one reaches the schema it has already
    been through a double, which is precisely the loss the scalar exists to prevent, so accepting it
    would defeat the point silently.

    **`scale=` is a validation constraint — at most N decimal places — not a formatting directive.**
    It cannot be one: the router assigns `ctx.body` and Koa serializes it with a `JSON.stringify` we
    have no replacer for, so the wire form is whatever decimal.js normalizes to and `"1250.00"` reads
    back as `"1250"`. The two are the same number; format at the display edge if you need the trailing
    zeros. This is also what `scale` means in OpenAPI `pattern`, pydantic `condecimal(decimal_places=)`
    and Prisma `@db.Decimal(_, n)`, so every downstream mapping stays honest.

    Generated code sets `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 })` so values never serialize in
    exponential notation — without it `0.00000001` ships as `"1e-8"` and any peer validating
    `^-?\d+(\.\d+)?$` rejects it. Note this is global decimal.js configuration and affects every
    `Decimal` in the consuming process.

    SDK clients rehydrate decimals through generated `reviveX` functions. The `bigint` approach does
    not transfer — it works only because bigint invented a tagged `"123n"` wire encoding, and tagging a
    decimal would corrupt the format for every non-ContractKit consumer. Re-parsing responses through
    the Zod schema is not available either: `XOutput` is a type alias with no runtime value, and models
    default to `z.strictObject`, so any field the server added would throw in every deployed client.
    The revivers mutate in place, which preserves unknown server-added keys.

    Two placements are rejected at parse time, both errors rather than warnings since no existing
    contract can be relying on them. A decimal inside an **undiscriminated union** cannot be rehydrated
    — the SDK has no way to tell which arm arrived, and a convert-if-string fallback would silently
    rewrite a genuine `string` field in a sibling arm. A decimal in a **response header** has no
    parsing step at all, so the annotation would simply be false at runtime.

    `min`/`max` are kept as exact decimal strings rather than coerced through `Number()`, and OpenAPI
    carries them in `x-contractkit-min`/`-max` extensions, since JSON Schema's numeric `minimum` and
    `maximum` are ignored on a string type. A contract round-trips through OpenAPI and back with its
    bounds intact.

    SDKs that scaffold a `package.json` gain `decimal.js` as a dependency when a covered model uses the
    scalar. Existing scaffolds are write-once and are not updated, so add it by hand there.

### Patch Changes

- Updated dependencies [e102a2c]
    - @contractkit/core@0.28.0

## 0.12.3

### Patch Changes

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.12.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.12.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.12.0

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

## 0.11.8

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.11.7

### Patch Changes

- 2bf01f1: Split multi-line descriptions across `#` comment lines and escape `"""` in generated method docstrings so ordinary multi-line doc comments can no longer produce invalid Python. Render the `interval` scalar as `str` and throw on an unmapped scalar type instead of falling back to `Any`.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.11.6

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.11.5

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.11.4

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.11.3

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.11.2

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0

## 0.11.1

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.11.0

### Minor Changes

- 4ac6d4d: Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

    `PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

    After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.10.1

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.10.0

### Minor Changes

- 10ca07b: Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.9.4

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.9.3

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.9.2

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.9.1

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

## 0.9.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.8.0

### Minor Changes

- e27b771: Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).

## 0.7.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

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

- 5d42e39: Enhance Python and TypeScript SDKs to support typed response headers. Updated the Python client to generate `TypedDict` for response headers and modified return types accordingly. The TypeScript SDK now includes runtime assertions for required headers and documents them in the generated markdown. Tests were added to verify the correct handling of response headers in both SDKs.

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

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
