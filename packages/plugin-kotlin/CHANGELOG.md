# @contractkit/plugin-kotlin

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

    The method passed `headers` to every leaf of its sealed response but never declared it, so the generated Kotlin referenced an unresolved `headers`. It now reads the declared headers into `<Method>Headers` (or `<Method>ResponseHeaders` when the operation also declares request headers) before dispatching on the content type, as the multi-status path already did.

    `KOTLIN_CODEGEN_VERSION` is bumped to `2`, so a warm `.contractkit/cache` does not keep the broken client across the upgrade.

- Updated dependencies [a440886]
- Updated dependencies [153134e]
    - @contractkit/core@0.31.0

## 0.1.5

### Patch Changes

- 03e1f95: Fix two naming collisions in the generated SDK.

    A path param named after one of the method's own arguments or locals was declared twice: `/notes/{body}` on an operation with a request body gave `putNote(body: String, body: Note)`. A path param now gets a trailing underscore when it lands on `body`, `query`, `customHeaders`, `params`, the `response` and `headers` locals, or the client's `http` property, so that method takes `body_: String`. Keyword escaping is unchanged (`` `class`: String ``).

    An operation that declares both a request `headers:` block and response headers generated two classes named `<Method>Headers` in one package. The request class keeps that name, since it is the one a caller constructs, and the response class becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.

## 0.1.4

### Patch Changes

- b0f3778: Published builds no longer wrap every function in a `__name()` call, so a bundler can drop the
  exports it does not use. The shared tsconfig enabled `emitDecoratorMetadata`, which made tsup compile
  through swc with `keepNames` forced on, and nothing in the repo uses decorators. `@contractkit/core`
  shrinks by about 7%, and anything that bundles it, the VS Code extension included, no longer
  carries core functions it never calls.
- Updated dependencies [b0f3778]
    - @contractkit/core@0.30.1

## 0.1.3

### Patch Changes

- Updated dependencies [17f4261]
    - @contractkit/core@0.30.0

## 0.1.2

### Patch Changes

- 35b8927: Fix a contract's `format(input=)` / `format(output=)` being dropped from the generated Kotlin.

    The casing renames the keys on the wire without changing the field names the contract declares, and
    kotlinx.serialization has no per-class key transform — so the rename has to reach every field as a
    `@SerialName`. It reached none: `renderField` derived the wire name from the Kotlin property and
    annotated a field only when the contract had already spelled it differently, never consulting
    `outputCase` or `inputCase`. `contract format(output=snake) AuthenticationTokenIssued` therefore
    generated `val accessToken: String` against a server sending `access_token`, and the first real
    response failed to decode with `MissingFieldException` — a report that names the field but says
    nothing about the casing that renamed it, in a package whose output had only ever been checked by
    compiling it.

    The two directions are now read separately, because they describe different halves of a round trip:
    a class that decodes a response follows `output`, and an `Input` twin that encodes a request follows
    `input`. A model with no Input twin is one class used both ways and can spell only one set of keys,
    so a contract setting both directions to different cases is warned about rather than silently
    resolved in whichever one happens to render. An anonymous object nested inside a renamed contract is
    still hoisted into a class that keeps its own key names — the hoisting pass records no owner to take
    the casing from — and that gap is now warned about at the one place the owner is still known.

## 0.1.1

### Patch Changes

- 2e59615: Fix two bugs that stopped the generated Kotlin from compiling. Both were found the first time the output was put through a real Kotlin toolchain, which the package README said had never happened.
    - **A comment OPENER in contract text swallowed the rest of the file.** `kdocLines` broke up `*/` but not `/*`, and Kotlin block comments nest: a `/*` inside a KDoc opens a second comment that the KDoc's own terminator then closes, leaving the outer one open. A contract describing a route as `/auth/factors/*` was enough to do it, and the compiler reported the damage at the next declaration rather than anywhere near the text that caused it.
    - **A default against a NAMED enum contract was emitted as its wire spelling.** `contract Rating: enum(liked, neutral, disliked)` with `rating?: Rating = "neutral"` reaches the default renderer as a ref rather than as the enum node, so it fell through to the string branch and produced `val rating: Rating? = "neutral"` — a field typed as the enum class, initialized with a String. Refs to enum contracts now render the member, and a default naming no member leaves the field required rather than emitting an initializer that will not compile.

## 0.1.0

### Minor Changes

- e53a714: Add `@contractkit/plugin-kotlin`, a Kotlin Multiplatform SDK generator built on Ktor and kotlinx.serialization.

    It emits one `@Serializable` models file per contract file and one client of `suspend fun` methods per operation file, into a `commonMain` source set, alongside a small Ktor runtime and an aggregator that shares a single `HttpClient` across every client.

    Two places the language and Kotlin disagree, and how the generator resolves them:
    - **Inheritance.** A Kotlin `data class` cannot extend another, so a contract's bases are flattened into the generated class through core's `resolveEffectiveFields`, applying the same later-wins override rule the inheritance validator enforces.
    - **Unions.** Neither union form has an anonymous Kotlin equivalent, so each becomes a named `sealed interface` with a generated serializer. A plain union wraps each member in a case and decodes by trying members in declaration order, matching `z.union` on the server. A discriminated union is implemented by the member classes directly and dispatches on the tag, which stays a real defaulted property rather than a kotlinx class discriminator — so a member still carries its tag when posted on its own, and one contract can belong to several unions.

    Enums, inline objects, intersections and odd-arity tuples used inside a field are hoisted into named declarations, uniquely across the whole project. Response headers are converted to their declared types; an operation declaring several statuses or content types returns a flat sealed interface, so a caller's `when` stays exhaustive. Which statuses come back as a value and which raise `SdkError` follows the same `response-sets` rule the router and the other SDKs use.

    `scaffold: true` writes `build.gradle.kts`, `settings.gradle.kts` and `gradle.properties` once, as user-owned files.

    The generator is unit- and snapshot-tested, but the Kotlin it emits has not yet been compiled against a real toolchain. See the package README for that and the other known limitations.
