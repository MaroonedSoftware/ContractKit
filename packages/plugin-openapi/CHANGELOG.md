# @contractkit/contractkit-plugin-openapi

## 0.11.0

### Minor Changes

- f453bf5: Honour the optionality an inline `query:` or `headers:` block declares, in the router, the SDK and the OpenAPI document.

    All three read the same `OpParamNode.optional`, and all three ignored it. The router validated every inline param as required, the SDK typed every one optional, and OpenAPI marked every non-path parameter `required: false`. So for a contract saying

    ```
    query: { limit?: int = 20, cursor: string }
    headers: { api-key?: string, x-tenant: string }
    ```

    the SDK let you omit a `cursor` the router would then reject, while typing `limit` as something you had to think about even though it has a default; and the published spec disagreed with both.

    Now:
    - **Router** — the param schema carries the same modifier chain a model field does, via the shared `applyFieldModifiers`. `limit` becomes `.default(20)`, `api-key` becomes `.optional()`. The hand-rolled query-array preprocess is gone too, delegating to `renderQueryType`, which already had that rule.
    - **SDK** — a field is optional only when the contract says so, either with `?` or by carrying a default. The whole argument is optional only when every field is, since a caller cannot omit an object that must supply something.
    - **OpenAPI** — `required` follows the contract for query and header parameters, matching what the `inlineObject` branch already did. The two `$ref` branches are unchanged: a whole-model param source has no per-field optionality to read.

    **Python is deliberately excluded.** It hardcodes `optional: true` on query and headers, and has the same ordering constraint as a `SyntaxError` rather than a type error. Permissive is safe; changing it belongs with the work that gives inline query params a `TypedDict`.

    ### What this breaks

    **SDK call sites stop compiling when an argument becomes required.** The old signature was wrong in both directions at once, so this surfaces two different latent bugs: calls that omitted a value the router demanded, and required fields typed as optional so nothing made you pass them.

    **Requests omitting a non-optional inline param now get a 400.** They were already being rejected by the router; what changes is that the SDK and the spec now say so. To find the affected surface, grep your contracts for inline `query:` and `headers:` blocks whose fields lack a `?` — that set is exactly the delta.

    One case only becomes reachable now: parameter order is path, body, query, then customHeaders, so an all-optional `query:` in front of an all-required `headers:` would emit `async m(query?: Q, customHeaders: H)`, which is `TS1016`. A normalisation pass clears `optional` on every argument before the last required one, which is the only fix that keeps the positional order call sites depend on.

### Patch Changes

- 1011911: Quote numeric YAML keys, so response status codes are strings as OpenAPI requires.

    `yamlKey` left any key matching `/^[\w-]+$/` bare, which includes `200`. A YAML 1.2 parser reads a bare `200:` as the integer `200`, while OpenAPI 3.x specifies the keys of a `responses` object as strings — so a strict validator rejected the emitted document, and any consumer indexing the map by `"200"` missed it.

    The guard now excludes a leading digit, mirroring the one `yamlString` has carried all along. `\w` also matches `_`, so a key like `_3DModel` correctly stays bare.

    This was invisible to the existing tests because they assert on the emitted _text_, and the defect is in how a conforming parser interprets those bytes. A new test parses the output with `yaml`'s document API, which preserves each key's actual scalar type, and asserts every response key came back as a string.

    The reverse direction is unaffected: `openapi-to-ck` reads responses through `Object.entries`, which hands back string keys either way.

    Visible in diffs but not breaking: `200:` becomes `'200':`.

- Updated dependencies [27af3f2]
- Updated dependencies [227c224]
- Updated dependencies [135947f]
- Updated dependencies [cb06aec]
    - @contractkit/core@0.29.0

## 0.10.2

### Patch Changes

- Updated dependencies [74b8a28]
    - @contractkit/core@0.28.2

## 0.10.1

### Patch Changes

- ffb2ec6: Ship an `llms.txt` in every package, so an AI assistant reading the package out of `node_modules` gets its exact name, a config block with real key names, the full option table, the programmatic API, and the mistakes specific to it — without needing the repo checked out.

    Correct several documented snippets that could not work as written. The five plugin READMEs named packages that do not exist (`@contractkit/contractkit-plugin-*`, and `-python-sdk` for the Python plugin) in both their install commands and their `contractkit.config.json` keys. `@contractkit/core`'s README exported `Diagnostics` and `validateOperation`, which are really `DiagnosticCollector` and `validateOp`, and gave the wrong signatures for three validation passes. `@contractkit/cli`'s README documented the OpenAPI importer as `contractkit openapi-to-ck --input <spec>`; it is `contractkit import-openapi <spec>`, with the path positional. `@contractkit/plugin-openapi` described its output as OpenAPI 3.0, but it emits 3.1.

- Updated dependencies [ffb2ec6]
    - @contractkit/core@0.28.1

## 0.10.0

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

## 0.9.3

### Patch Changes

- 8987af2: Carry `name:` and the documented-response marker into the generated spec

    OpenAPI has no way to say whether a service produces a status or merely documents it, so the
    distinction `.ck` draws was lost on the way out and could not be recovered on the way back in:
    a `.ck` → OpenAPI → `.ck` round trip turned every `(documented)` error response into a
    service-produced one, silently changing what the generated router and SDKs do.

    A response marked `(documented)` now carries `x-contractkit-emit: documented`, which
    `@contractkit/openapi-to-ck` honours on import. Vendor extensions are spec-legal and ignored by
    other tooling.

    An operation's `name:` is now emitted as the OpenAPI `summary`, which it previously omitted
    entirely.

- Updated dependencies [aea5e21]
- Updated dependencies [5dc2693]
    - @contractkit/core@0.27.0

## 0.9.2

### Patch Changes

- ca1c139: Declare the MIT license explicitly: every package now ships a `LICENSE` file in its published tarball and sets `"license": "MIT"` in its manifest, so license scanners and registries report the terms correctly.
- Updated dependencies [ca1c139]
    - @contractkit/core@0.26.1

## 0.9.1

### Patch Changes

- Updated dependencies [ab69718]
    - @contractkit/core@0.26.0

## 0.9.0

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

## 0.8.15

### Patch Changes

- Updated dependencies [23e4beb]
    - @contractkit/core@0.24.0

## 0.8.14

### Patch Changes

- 2bf01f1: Emit explicit schemas for the `time` and `interval` scalars instead of type-less (permissive) schemas, and throw on an unmapped scalar type so a missing mapping fails loudly rather than producing an empty schema.
- Updated dependencies [2bf01f1]
    - @contractkit/core@0.23.0

## 0.8.13

### Patch Changes

- Updated dependencies [0d3b8e2]
    - @contractkit/core@0.22.0

## 0.8.12

### Patch Changes

- Updated dependencies [fff30df]
    - @contractkit/core@0.21.0

## 0.8.11

### Patch Changes

- Updated dependencies [bdebb9c]
- Updated dependencies [90f45ff]
    - @contractkit/core@0.20.0

## 0.8.10

### Patch Changes

- Updated dependencies [a049895]
    - @contractkit/core@0.19.0

## 0.8.9

### Patch Changes

- Updated dependencies [dd8197b]
    - @contractkit/core@0.18.0

## 0.8.8

### Patch Changes

- Updated dependencies [79af33b]
    - @contractkit/core@0.17.0

## 0.8.7

### Patch Changes

- Updated dependencies [4ac6d4d]
    - @contractkit/core@0.16.0

## 0.8.6

### Patch Changes

- Updated dependencies [130d53b]
    - @contractkit/core@0.15.1

## 0.8.5

### Patch Changes

- Updated dependencies [10ca07b]
    - @contractkit/core@0.15.0

## 0.8.4

### Patch Changes

- Updated dependencies [a9e9ec0]
    - @contractkit/core@0.14.0

## 0.8.3

### Patch Changes

- Updated dependencies [7555412]
    - @contractkit/core@0.13.0

## 0.8.2

### Patch Changes

- Updated dependencies [876696f]
    - @contractkit/core@0.12.0

## 0.8.1

### Patch Changes

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

- e27b771: Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).

## 0.6.1

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
