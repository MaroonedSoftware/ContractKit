# @contractkit/plugin-swift

## 0.2.0

### Minor Changes

- 059eec6: Every generated runtime now accepts exactly the `decimal` strings the published OpenAPI `pattern` does: plain digits, `^-?[0-9]+(\.[0-9]+)?$`. This is a breaking narrowing for anyone sending exponents, hex, `+5`, `.5`, `5.` or non-finite values.
    - **core** exports `DECIMAL_PATTERN` and `decimalPattern(scale)`, the single definition every plugin now uses.
    - **plugin-typescript**: `_ZodDecimal` and the SDK's `__dec` reviver hand a string to decimal.js only when it matches the pattern, and require a finite value. A bare `decimal` field used to accept `"NaN"`, `"Infinity"`, `"1e5"`, `"0x1F"`, `"+5"` and `"1_000"`. The server now answers those with a 400.
    - **plugin-docs**: the `scale=N` pattern allows trailing zeros past the scale (`^-?[0-9]+(\.[0-9]{1,N}0*)?$`), matching the validator, which counts places after trailing zeros are dropped. Previously the spec rejected `"1.10"` at `scale=1` while the server accepted it. `scale=0` now publishes a valid pattern instead of `\d{1,0}`. Patterns are spelled with `[0-9]`, which is equivalent under ECMA-262 and means the same in every SDK language.
    - **plugin-python**: a `decimal` field is typed `ExactDecimal`. It reads only plain digit strings (plus an exact `Decimal` or `int` when building a model), and writes plain digits. A `Decimal` in a model, query, header or path parameter used to go out as `str(value)`, which sends `0.00000001` as `"1E-8"`.
    - **plugin-csharp**: `DecimalStringConverter` reads only plain digits, where `NumberStyles.Float` also took exponents, `+` and whitespace. A value past `System.Decimal`'s range raises a `JsonException` instead of an `OverflowException`.
    - **plugin-kotlin**: `Decimal` checks its text on construction (`IllegalArgumentException`) and on decoding (`SerializationException`).
    - **plugin-swift**: `DecimalValue` throws when decoding or encoding text outside the pattern. `init(_:)` is unchanged.

    The TypeScript, Python, C#, Kotlin and Swift codegen versions are bumped, so an existing incremental cache regenerates.

### Patch Changes

- Updated dependencies [059eec6]
    - @contractkit/core@0.33.0

## 0.1.8

### Patch Changes

- Updated dependencies [8b299f6]
    - @contractkit/core@0.32.0

## 0.1.7

### Patch Changes

- Updated dependencies [b1bb346]
    - @contractkit/core@0.31.1

## 0.1.6

### Patch Changes

- 153134e: A default on a `bigint` field is parsed as an exact `bigint`, and the generated TypeScript for one compiles.

    `quantity: bigint = 9007199254740993` used to parse to the JS number `9007199254740992`, so every generator emitted the rounded value and `pnpm format` wrote it back into the file. The parser now reads the literal's digits into a `bigint`, for a `bigint` field or a `bigint | null` one. A non-integer default such as `= 1.5` is reported as an error instead. `FieldNode.default` and `OpParamNode.default` are typed `FieldDefault`, which adds `bigint`, so plugins that read a default have one more case to handle. The new `coerceDefault` export applies the rule.

    The TypeScript plugin wrote a bigint default as `.default(5)`. Zod requires a default to be the schema's output type, so every generated project with a bigint default failed to typecheck (TS2769). At runtime the handler would also have received a `number`, because Zod returns a default without parsing it. It now writes `.default(5n)`.

    Every other consumer handles the new value: Kotlin, Swift and C# initialize from the exact digits, Bruno and the `openapi` target write the digit string a `bigint` travels as, `openapi-to-ck` reads that string back with `BigInt()` rather than `Number()`, and the VS Code hover no longer throws when a referenced model carries a bigint default.

    A default on a field whose type is a `ref` to a `bigint` alias is still parsed as a number, because the alias is not resolved at parse time.

- 1977a4f: A status that declares several content types and response headers now generates a client that compiles.

    The method passed `headers` to every case of its response enum but never declared it, so `swift build` failed with "cannot find 'headers' in scope". It now reads the declared headers into `<Method>Headers` (or `<Method>ResponseHeaders` when the operation also declares request headers) before switching on the content type, as the multi-status path already did. The output-tests fixture now covers this shape, so the Swift compile check guards it.

    `SWIFT_CODEGEN_VERSION` is bumped to `2`, so a warm `.contractkit/cache` does not keep the broken client across the upgrade.

- Updated dependencies [a440886]
- Updated dependencies [153134e]
    - @contractkit/core@0.31.0

## 0.1.5

### Patch Changes

- 9541fcb: Fix two naming collisions that made the generated SDK fail to compile.

    A path param named after one of the method's own arguments or locals was declared twice: `/notes/{body}` on an operation with a request body gave `putNote(body: String, body: Note)`. A path param now gets a trailing underscore when it lands on `body`, `query`, `customHeaders`, `params`, the `request`, `response` and `headers` locals, or the client's `http` property, so that method takes `body_: String`. Keyword escaping is unchanged (`` `class`: String ``).

    An operation that declares both a request `headers:` block and response headers generated two structs named `<Method>Headers` in one module, an invalid redeclaration. The request struct keeps that name, since it is the one a caller constructs, and the response struct becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.

## 0.1.4

### Patch Changes

- 54ab348: A model with a field named `container`, `encoder` or `decoder` now compiles. The generated
  `encode(to:)` and `init(from:)` read each stored property bare, beside a local `container` and the
  `encoder` or `decoder` parameter, so a field with one of those names resolved to the local instead:
  `try container.encode(container, forKey: .container)` failed to compile, and a literal field's
  guard in `init(from:)` compared the wrong value. Every property read in a coder is now written
  `self.<name>`. Found by building the SDK for a real service whose status model has a `container`
  field; `stress.ck` now holds a contract with all three names, and the probe decodes, encodes and
  rejects through it.

## 0.1.3

### Patch Changes

- a89eb14: The generated Swift is now compiled and run in the test suite, and the README no longer says it
  has never been built.

    Two tests build a generated package with a real Swift toolchain, in Swift 6 language mode with
    complete concurrency checking and warnings as errors. One covers the shared cross-plugin fixtures.
    The other covers a contract holding every construct the generator branches on: both union forms,
    self and mutual recursion, tuples, records, every scalar, `format()` key casing, flattened
    inheritance with readonly and writeonly fields, keyword field and method names, multipart
    requests, and multi-status, multi-content-type responses. It then runs a probe of 57 checks that
    decode, encode and round-trip through the generated types and drive the generated client over a
    mock transport, because a compile cannot see a struct that builds and then fails to decode.

    The first build found nothing to fix. The generated code itself is unchanged. Both tests skip when
    `swift` is not installed.

## 0.1.2

### Patch Changes

- b0f3778: Published builds no longer wrap every function in a `__name()` call, so a bundler can drop the
  exports it does not use. The shared tsconfig enabled `emitDecoratorMetadata`, which made tsup compile
  through swc with `keepNames` forced on, and nothing in the repo uses decorators. `@contractkit/core`
  shrinks by about 7%, and anything that bundles it, the VS Code extension included, no longer
  carries core functions it never calls.
- Updated dependencies [b0f3778]
    - @contractkit/core@0.30.1

## 0.1.1

### Patch Changes

- Updated dependencies [17f4261]
    - @contractkit/core@0.30.0

## 0.1.0

### Minor Changes

- 707316a: Add `@contractkit/plugin-swift`, a Swift SDK generator built on `Codable` and `URLSession`.

    It emits one models file per contract file and one client of `async throws` methods per operation file, into a single Swift module, alongside a small runtime and an aggregator that shares one `SdkHttp` across every client. The generated package depends on nothing but Foundation.

    Three places the language and Swift disagree, and how the generator resolves them:
    - **Inheritance.** A Swift struct cannot extend another, so a contract's bases are flattened into the generated struct through core's `resolveEffectiveFields`, applying the same later-wins override rule the inheritance validator enforces.
    - **Recursion.** A struct cannot contain itself even behind an `Optional`, with or without a `lazy(...)` marker. A whole-project pass finds every stored property that closes a cycle of value types and routes it through a generated `Indirect` box, behind a computed property that leaves the public API and the wire format unchanged. A cycle through an array, a dictionary, or a union enum needs no box.
    - **Unions.** Neither union form has an anonymous Swift equivalent, so each becomes a named `indirect enum`. A plain union gets one payload case per member and decodes by trying members in declaration order, matching `z.union` on the server. A discriminated union reads the tag through a dynamic coding key and hands the same decoder to the member it names, then encodes by delegating to it — so a member still carries its tag when posted on its own, and one contract can belong to several unions.

    Every struct writes its own `CodingKeys`, `init(from:)` and `encode(to:)` rather than relying on the synthesized ones. That is what makes the four field shapes exact: an optional field is omitted, a required nullable one is written as an explicit `null` and fails to decode when the key is absent, a default is filled in and always sent, and a `literal()` is validated on the way in. It also lets one struct decode under `format(output=)` keys and encode under `format(input=)` ones.

    Enums, inline objects, intersections and tuples used inside a field are hoisted into named declarations, uniquely across the module. Response headers are converted to their declared types; an operation declaring several statuses or content types returns a flat enum, so a caller's `switch` stays exhaustive. Which statuses come back as a value and which raise `SdkError` follows the same `response-sets` rule the router and the other SDKs use.

    `scaffold: true` writes `Package.swift` once, as a user-owned file.

    The generator is unit- and snapshot-tested, but the Swift it emits has not yet been compiled against a real toolchain. See the package README for that and the other known limitations.
