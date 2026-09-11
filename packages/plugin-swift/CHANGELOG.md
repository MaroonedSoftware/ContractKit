# @contractkit/plugin-swift

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
