# @contractkit/plugin-swift

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
