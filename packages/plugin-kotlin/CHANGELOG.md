# @contractkit/plugin-kotlin

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
