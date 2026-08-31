# @contractkit/contractkit-plugin-typescript

## 0.33.0

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

- e102a2c: Fix scalar lists that had drifted out of sync with the language

    Four places kept a hand-written copy of the language's scalar names, and three had already fallen
    behind without anything failing to build:
    - The VS Code completion list and hover map were both missing `interval`, so the editor silently
      stopped recognising it — no completion, no hover.
    - The constraint-argument regex that decides when to offer `min=`/`max=` completions was missing
      `time`, `interval`, and every non-constrainable scalar.
    - `docs/language.md`'s scalar table was missing `duration`.

    The completion and semantic-token providers now read `SCALAR_NAMES` from `@contractkit/core`
    directly, which removes the drift class rather than patching this instance of it, and the
    constraint regex is built from those lists. What genuinely cannot derive from the set — a TextMate
    alternation, a per-scalar documentation map, a Markdown table — is now covered by a test that fails
    when any of them falls behind.

    Also fixes the SDK scaffold's luxon detection, which omitted `duration`. `generateContract` imports
    `Duration` from luxon whenever that scalar is present, so a contract whose only temporal type was a
    duration scaffolded a `package.json` with no `luxon` dependency and did not compile.

- Updated dependencies [e102a2c]
    - @contractkit/core@0.28.0

## 0.32.0

### Minor Changes

- 5dc2693: Add `server.validateResponses` — the generated Koa router can now validate what it sends, not just
  what it receives

    Handlers have always run request params, query, headers and body through `parseAndValidate`. The
    service's return value got nothing: it was type-annotated and assigned straight to `ctx.body`, so a
    service returning a shape its own contract forbids shipped it to the client unchanged. With
    `server.validateResponses: true` the result is re-parsed against the declared response schema and
    the _parsed_ value is written:

    ```ts
    const result: User = await service.getById(id);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = await parseAndValidate(result, User, 500);
    ```

    Because the parsed value is what reaches the wire, `mode(strip)` now actually strips extra keys off
    responses.
    - **Opt-in, and off by default**, because turning it on surfaces real drift. TypeScript only
      excess-property-checks object _literals_, so a service returning a database row with undeclared
      columns satisfies `const result: User` today and quietly ships them; under the default `strict`
      mode that becomes a 500. That is the flag working, but it is not a change to make on a Friday.
    - **`zod: true` is a hard prerequisite.** Without it `output.types` emits plain interfaces — types
      with no runtime schema value to validate against. Setting `validateResponses` alone now fails the
      build with an explicit message instead of emitting code that cannot compile. This is the plugin's
      first config assertion; it runs for both the default export and `createTypescriptPlugin`.
    - **Requires `@maroonedsoftware/zod` 0.6.1 or later** for the `statusCode` argument. Failures are
      raised as `500`, not the `400` a request-side failure gets — a service breaking its own contract
      is a server fault. At 5xx that package puts the field-level map on `internalDetails` rather than
      `details`, so `errorMiddleware` keeps it out of the response body and on the log path.

    Two kinds of response body are deliberately left unvalidated, and generate exactly as before:
    - **Anything transitively referencing a model with `format(input=…)` or `format(output=…)`.** Those
      schemas transform keys between wire and developer-facing casing, and the service already returns
      the post-transform shape, so re-parsing it through the same schema would fail on every key. Note
      this needs a wider set than `modelsWithOutput`, which seeds only from `outputCase` because only
      that case needs an `Output` type alias — a `format(input=snake)`-only model is just as
      untouchable. `@contractkit/core` gains `computeModelsWithCaseTransform` for it.
    - **A status whose several content types carry different body shapes**, where `contentType` and
      `body` are correlated across union members. Matching shapes (`image/png` and `image/jpeg` both
      `binary`) share one schema and validate normally.

    One wart worth knowing: `ctx.status` and any `ctx.set(…)` response headers are written before the
    body, so a validation failure raises its 500 with the success path's headers already set.

    Projects that do not set the flag generate byte-identical routers.

### Patch Changes

- 5dc2693: Stop the generated Koa router emitting imports nothing in the file references

    `collectTypes` and `collectServices` walk the AST, and the AST over-approximates what a router
    actually uses in three ways:
    - A model with an `Input` or `Output` variant contributed **both** its base name and the variant,
      even when only the variant is ever annotated. A response typed `AuthTokenOutput` emitted
      `import { AuthToken, AuthTokenOutput }`, and a request body validated against `CreateUserInput`
      emitted `import { CreateUser, CreateUserInput }`.
    - Both collectors walk every operation, including the `internal` ones `includeInternal: false`
      drops. A router whose only operation was excluded still imported that operation's service and
      response model, with no handler left to use either.

    In a consuming project with `noUnusedLocals` — or the equivalent lint rule — each of those is a
    compile error in generated code the user cannot edit.

    Every collected service and model name is now filtered through the same `uses` gate that already
    prunes `parseAndValidate`, `requirePolicy`, `MultipartBody` and the luxon imports: a name is
    imported only if it appears in the generated body. This is the approach the file's own comment
    already argued for — deciding imports from the emitted text rather than from predicates over the
    AST that have to be kept in step with it by hand.

    Names that are genuinely used are unaffected, including a base model used as the runtime schema
    under `server.validateResponses`. `@contractkit/plugin-typescript`'s MCP output does not have this
    gap — its schema ids and service imports are both derived from the emitted tool plans.

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.31.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.31.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.31.0

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

## 0.30.0

### Minor Changes

- 23e4beb: Stop emitting unused imports in generated Koa routers. `bodyParserMiddleware` was imported unconditionally even when no operation declared a request body, and `MultipartBody` was imported whenever any body was multipart — including when the multipart body is structurally equal to its sibling MIME types and the handler collapses to a single `parseAndValidate` call that never references it. `requirePolicy`, `requireSignature` and `parseAndValidate` could also go unused when `includeInternal: false` skipped the only handlers that needed them. Each unused import trips `noUnusedLocals` and lint in the consuming project.

    Imports are now derived from the generated body — a symbol is emitted only if it actually appears in the output — rather than from predicates over the AST that had to be kept in step by hand.

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.29.0

### Minor Changes

- 79e3049: Fix scalar response bodies in generated Koa routers, which emitted the `.ck` scalar name verbatim as a TypeScript type (`const result: binary`). Only `string`, `number`, `boolean`, `bigint`, `null` and `unknown` compiled by coincidence; `binary`, `int`, `uuid`, `datetime` and friends produced invalid code. Scalars now render as the type the handler actually receives: `binary` → `Buffer`, `int` → `number`, `datetime` → luxon `DateTime`, `interval` → `string`, `json` → `_JsonValue`.

    Generated routers now also import `Duration` and `Interval` from luxon and emit the `_ZodInterval` helper when an operation uses those scalars, instead of referencing undefined names.

    Plain type files emitted for the server render `binary` as `Buffer` rather than `Blob`. SDK output is unchanged. The standalone `types` sub-generator gained a `target` option (`"client" | "server"`, default `"client"`) to select between the two.

## 0.28.2

### Patch Changes

- ca9309a: Generated Koa route handlers now use `async ctx => {` instead of `async (ctx, next) => {`. The `next` argument was never referenced in the emitted body and tripped no-unused-vars lint rules in consuming projects.

## 0.28.1

### Patch Changes

- 2bf01f1: Escape `.ck` descriptions, enum values, and signature strings when generating Zod schemas and TypeScript so `*/`, quotes, or newlines can no longer break or inject into generated output. Contain every generated-file path within the configured output directory, rejecting `options { keys }` values that would escape it. Throw on an unmapped scalar type instead of silently emitting `z.unknown()`/`unknown`.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.28.0

### Minor Changes

- 8ac8343: Generated Koa routers now read the incoming request body from `ctx.parsedBody` instead of `ctx.body`, matching serverkit's refactor. The response body is still assigned via `ctx.body`.

## 0.27.0

### Minor Changes

- 0d3b8e2: Add opt-in `sdk.scaffold` to the TypeScript plugin, which emits a starter `package.json` and `tsconfig.json` at the SDK `baseDir` so generated output is a buildable, publishable package. Dependencies are derived from the contracts (`zod` when `zod: true`; `luxon`/`@types/luxon` when a date/time scalar is used). Scaffold files are write-once: a new `ctx.emitFile(path, content, { ifAbsent: true })` option writes them only when absent and never overwrites or orphan-deletes them, so disabling `scaffold` or editing the files later is always safe.

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.26.0

### Minor Changes

- fff30df: Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

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
