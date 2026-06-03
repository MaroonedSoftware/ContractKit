# @contractkit/contractkit-plugin-typescript

## 0.25.4

### Patch Changes

- c5e74a3: Emit the missing `import { MultipartBody } from '@maroonedsoftware/multipart'` in generated Koa routers when an operation declares a `multipart/form-data` request body.

## 0.25.3

### Patch Changes

- 5da85ca: Stop emitting `await next()` at the end of generated Koa route handlers — route handlers are the terminus of the middleware chain.

## 0.25.2

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.25.1

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.25.0

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

## 0.24.0

### Minor Changes

- 27521cc: Preserve the optional-field modality through `format(input=...)` / `format(output=...)` transforms. Optional fields are now emitted with a conditional spread (`...(data.x !== undefined ? { k: data.x } : {})` for output, `... != null` for input) so the inferred `z.input` / `z.output` type widens the property to `k?: T` instead of required-nullable `k: T | undefined`. Consumer code that constructs values with `...(x ? { k: x } : {})` is now assignable to the schema's inferred type. Runtime wire output is unchanged.

## 0.23.1

### Patch Changes

- 22c4a0b: Coerce `null` to `undefined` for optional fields in model-level `format(input=...)` / `format(output=...)` transforms, matching the existing behavior for inline objects.

## 0.23.0

### Minor Changes

- ff6f8ea: Expose response headers on `SdkError`. The generated error now carries `headers: Headers` (the raw `Headers` instance from the failed response) alongside `status`, `statusText`, and `body`, so catchers can read things like `X-Request-ID`, `Retry-After`, or `WWW-Authenticate` for logging, retry logic, and rate-limit handling.

## 0.22.0

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

## 0.21.0

### Minor Changes

- 2aad136: Move `<Area>Client` classes out of `sdk.ts` and into their own `<area>.client.ts` files. Previously the SDK aggregator declared the `<Area>Client` class inline and merged area-level methods into it; now the merged class is emitted to a synthesized `<area>.client.ts` next to its leaf subarea clients, and `sdk.ts` only imports it. The aggregator is now a thin file: imports + a `Sdk` class with property wiring.

    The area-client output path is derived from the same `output.clients` template as leaf clients via the new `computeSdkAreaClientOutPath` helper — `{filename}` and `{area}` substitute to the area name, `{subarea}` to empty (with double-slashes collapsed and any hidden `.client.ts` segment fixed up). For typical templates like `src/{area}/{subarea}.client.ts` or `src/{area}/{filename}.client.ts`, this produces `src/<area>/<area>.client.ts`.

    `generateSdkAggregator`'s `SdkAreaInfo` shape changed: `inlineFiles` and `subareaClients` are gone — the aggregator now takes a single `client: SdkClientInfo` per area pointing at the new file. Plugins / tooling consuming `generateSdkAggregator` directly need to update. The new `generateAreaClient` function takes the inline-file list + subarea clients and returns the `<area>.client.ts` content. Per-area cache units mean a change to one file's ops only re-renders that area's client.

    Consumers who imported an `<Area>Client` type directly from `sdk.ts` need to import from `./<area>/<area>.client.ts` (or `./<area>/<area>.js` after compile) instead — `Sdk` and `SdkOptions` continue to come from `sdk.ts`.

## 0.20.0

### Minor Changes

- 4ac6d4d: Move plugin incremental-build manifests under the CLI cache directory (default `.contractkit/cache/`, configurable via `config.cache.dir`). Bruno's `.contractkit-bruno-manifest.json` (in the bruno-collection dir), Python's `.contractkit-python-manifest.json` (in the python-sdk dir), and TypeScript's `.contractkit-typescript-manifest.json` (at rootDir) now all live as `bruno-manifest.json` / `python-manifest.json` / `typescript-manifest.json` under `ctx.cacheDir`, alongside the CLI's existing `build.json` and HTTP cache. Output dirs no longer contain build state.

    `PluginContext` gains a `cacheDir: string` field. `runIncrementalCodegen` no longer takes a `manifestFilename` argument and no longer bundles the manifest into `filesToWrite` — the result's `manifest` is returned separately so plugins can persist it wherever they want. New helper `serializeIncrementalManifest(manifest)` produces the JSON form.

    After upgrading, the old in-output manifests can be deleted manually (or with `--force`); plugins will simply do a full regen on the first run since they won't find a manifest at the new path.

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.19.1

### Patch Changes

- 130d53b: Fix `stableStringify` (and therefore `hashFingerprint` / `runIncrementalCodegen`) crashing with "Do not know how to serialize a BigInt" when an AST payload contains a `bigint` default or literal. Bigints now serialize as a tagged string `"<bigint:VALUE>"` so they're stable in fingerprints and distinguishable from plain strings. `undefined` is also normalized to `null` so `{a: undefined}` and `{}` don't collide.
- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.19.0

### Minor Changes

- 10ca07b: Add per-output incremental caching to the Bruno, Python, and TypeScript plugins. Editing a single contract or operation no longer regenerates every output file — only the units whose transitive inputs actually changed are re-rendered, with the rest reused from a per-plugin manifest. `@contractkit/core` exposes the shared utility (`runIncrementalCodegen`, `parseIncrementalManifest`, `hashFingerprint`, `collectTransitiveModelRefs`, manifest types) for plugin authors. `PluginContext` gains a `cacheEnabled` flag so plugins can honor `--force` / `cache: false`.

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.18.0

### Minor Changes

- 6f8e3b6: Group TypeScript SDK clients by `keys.area` and `keys.subarea`. Files declaring `subarea` produce a leaf `<Area><Subarea>Client` exposed at `sdk.<area>.<subarea>`; area-only files (no subarea) inline their methods directly onto a synthesized `<Area>Client` and surface as `sdk.<area>.<method>`. Files with no area keep the legacy flat `sdk.<filename>` shape.

    `{subarea}` is a new path-template variable on `output.clients` and `output.types`, enabling layouts like `src/{area}/{subarea}.client.ts`. Multiple area-level files merging into one client throw a codegen-time error if any method names collide — disambiguate with `sdk:` or move into a subarea.

    Breaking: area-level files no longer emit a standalone `*.client.ts` (their methods live on the area client in `sdk.ts`). The `generateSdkAggregator` signature now takes a structured `SdkAggregatorInput` rather than `(clients, importPath?, className?)`.

## 0.17.5

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.17.4

### Patch Changes

- 684a639: Fix plain TypeScript codegen producing invalid `extends` clauses when a child contract redeclares an inherited field without the explicit `override` keyword (e.g. narrowing `kind: BusinessRoleKind` to `kind: 'employee'`). The base is now wrapped in `Omit<Base, 'fieldName'>` for any redeclared field, matching the behaviour for explicit `override` fields.

## 0.17.3

### Patch Changes

- 1247514: Fix `override readonly` fields not being omitted from child Input schemas in Zod codegen

## 0.17.2

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.17.1

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.17.0

### Minor Changes

- b3f7da9: Fix `ref & ref` type alias intersections generating `ZodIntersection` instead of `ZodObject`

    Contracts like `contract Foo: A & B` (two model refs, no inline fields) previously emitted `A.and(B)`, producing a `ZodIntersection`. This broke `.strict()` calls on the result and caused each strict schema to reject the other's keys at runtime.

    All three rendering paths (`renderIntersection`, `renderInputType`, `renderQueryType`) now emit `.extend(B.shape)` chains for any `ref & (ref | inlineObject)*` intersection, matching the pattern already used for multi-base model inheritance.

## 0.16.1

### Patch Changes

- Updated dependencies [c9f2166]
    - @contractkit/core@0.11.0

## 0.16.0

### Minor Changes

- bbee232: prep for public release

### Patch Changes

- Updated dependencies [bbee232]
    - @contractkit/core@0.10.0

## 0.15.0

### Minor Changes

- e27b771: Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).

## 0.14.1

### Patch Changes

- 206120c: Fix double-anchoring in Zod regex codegen: patterns that already contain `^` or an unescaped trailing `$` are now emitted as-written instead of being wrapped a second time. Patterns without anchors continue to be auto-anchored to `^...$` for full-match semantics.

## 0.14.0

### Minor Changes

- d13614c: Enhance content type handling in contract DSL. This update introduces support for vendor JSON MIME types and improves the classification of content types, allowing for better handling of text and binary responses. The grammar has been updated to accept a wider range of MIME types, and tests have been added to ensure correct parsing and serialization behavior. Additionally, the code has been refactored to normalize content types for stable comparisons and to support multi-MIME request bodies.

### Patch Changes

- Updated dependencies [d13614c]
    - @maroonedsoftware/contractkit@0.9.0

## 0.13.0

### Minor Changes

- 353aa10: Implement options-level header globals for request and response in the contract DSL. This update allows headers to be declared at the file level, merging them into every operation's request and response. Added normalization logic to handle header collisions and opt-out scenarios. Updated documentation and tests to reflect these changes, ensuring proper round-trip formatting and validation of headers.
- 888ded5: Enhance contract DSL with multi-base inheritance support and override modifier. This update introduces the ability to declare multiple base contracts, along with validation rules for field conflicts across bases. The `override` modifier is now required for redeclaring conflicting fields, and the documentation has been updated to reflect these changes. Tests have been added to ensure correct behavior for inheritance and modifier usage.

### Patch Changes

- Updated dependencies [353aa10]
- Updated dependencies [888ded5]
    - @maroonedsoftware/contractkit@0.8.0

## 0.12.0

### Minor Changes

- 16ac3a7: Implement support for typed response headers in API operations. Added functionality to declare headers alongside response bodies, affecting OpenAPI, TypeScript SDK, and Markdown documentation generation. Updated related tests to ensure correct parsing and rendering of response headers, including handling optional headers and duplicate declarations.

### Patch Changes

- Updated dependencies [16ac3a7]
    - @maroonedsoftware/contractkit@0.7.0

## 0.11.0

### Minor Changes

- d3ea773: Enhance model handling by introducing Output variants for response types in code generation. Updated functions to compute and collect models with Output variants, ensuring compatibility with serialization logic. Added tests to verify correct generation of Output types based on model configurations.

### Patch Changes

- Updated dependencies [d3ea773]
    - @maroonedsoftware/contractkit@0.6.0

## 0.10.0

### Minor Changes

- ddb6a28: Refactor type generation in codegen-contract to use z.input for developer-facing types when outputCase is set. Updated tests to reflect this change in type handling for improved clarity in serialization logic.

## 0.9.0

### Minor Changes

- 2c9e9a9: Fix type casting in URLSearchParams serialization for form data in codegen-sdk. Updated tests to reflect changes in body serialization logic.

## 0.8.0

### Minor Changes

- 1b336ec: Enhance contract generation by introducing a flattening mechanism for format chains. This allows child models to inline parent fields and inherit transformations, ensuring compatibility with ZodPipe structures. Updated the model generation logic and added tests to verify the new behavior for child models extending formatted parents.

## 0.7.0

### Minor Changes

- 181dadb: Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.

### Patch Changes

- Updated dependencies [181dadb]
    - @maroonedsoftware/contractkit@0.5.0

## 0.6.0

### Minor Changes

- ada5f84: Implement discriminated unions in ContractKit with validation and code generation support. Update README and tests to reflect new functionality, including parsing, rendering, and OpenAPI generation for discriminated unions.

### Patch Changes

- Updated dependencies [ada5f84]
    - @maroonedsoftware/contractkit@0.4.0

## 0.5.0

### Minor Changes

- 506af42: Enhance input type reference collection in code generation by adding support for tuple, record, union, intersection, lazy, and inlineObject types. Added corresponding test case for intersection query handling.

## 0.4.0

### Minor Changes

- 3d90443: Update ZodInterval transformation to include ISO string conversion in contract generation and corresponding test case.

## 0.3.0

### Minor Changes

- f396a68: Enhance scalar type support by adding 'interval' to the ContractKit

### Patch Changes

- Updated dependencies [f396a68]
    - @maroonedsoftware/contractkit@0.3.0

## 0.2.0

### Minor Changes

- db7345b: updating to contractkit as the org

### Patch Changes

- Updated dependencies [db7345b]
    - @contractkit/core@0.2.0
