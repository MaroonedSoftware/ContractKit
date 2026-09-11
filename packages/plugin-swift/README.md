# @contractkit/plugin-swift

ContractKit's Swift SDK generator. Emits `Codable` models and an async/await client, as a SwiftPM
package that depends on nothing but Foundation.

## Install

```bash
pnpm add -D @contractkit/cli @contractkit/plugin-swift
```

## Configure

`plugins` is an **object** keyed by package name, not an array.

```json
{
    "rootDir": ".",
    "patterns": ["contracts/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-swift": {
            "baseDir": "clients/swift/",
            "moduleName": "AcmeSdk",
            "sdkName": "Acme"
        }
    }
}
```

| Option            | Type      | Default            | Meaning                                                                  |
| ----------------- | --------- | ------------------ | ------------------------------------------------------------------------ |
| `baseDir`         | `string`  | `"swift-sdk"`      | Output directory, relative to `rootDir`                                  |
| `moduleName`      | `string`  | `"ContractKitSdk"` | SwiftPM target and product name; sources land in `Sources/<moduleName>/` |
| `sdkName`         | `string`  | `"Sdk"`            | Aggregator class name. Must differ from `moduleName`                     |
| `includeInternal` | `boolean` | `false`            | Emit client methods for operations marked `internal`                     |
| `scaffold`        | `boolean` | `false`            | Emit `Package.swift` once, as a user-owned file                          |

A type cannot share a name with the module that contains it, so `moduleName` and `sdkName` have to
differ — the generator rejects a config where they don't. It rejects a contract named after a Swift,
Foundation, or runtime type for the same reason: a contract called `Error` would shadow the protocol
every `throws` in the client depends on.

## Type mapping

| `.ck`                                | Swift                                                            |
| ------------------------------------ | ---------------------------------------------------------------- |
| `string`, `email`, `url`, `interval` | `String`                                                         |
| `number`                             | `Double`                                                         |
| `int`                                | `Int`                                                            |
| `bigint`                             | `BigIntValue` (generated string-backed struct)                   |
| `decimal`                            | `DecimalValue` (generated string-backed struct)                  |
| `boolean`                            | `Bool`                                                           |
| `date`, `time`, `duration`           | `LocalDate` / `LocalTime` / `IsoDuration` (generated)            |
| `datetime`                           | `Date` (ISO 8601, fractional seconds optional on the way in)     |
| `uuid`                               | `UUID`                                                           |
| `binary`                             | `Data`                                                           |
| `unknown`, `json`, `object`, `null`  | `JSONValue` (generated recursive enum)                           |
| `array(T)`                           | `[T]`                                                            |
| `record(K, V)`                       | `[String: V]`                                                    |
| `tuple(...)`                         | a generated struct with `_0`, `_1`, … travelling as a JSON array |

`Int` is 32-bit on watchOS's `arm64_32`. The source language's `int` is a JS safe integer, so a
value above 2^31 would overflow there; nowhere else.

Four scalars are generated structs over their source text rather than Foundation types.
`Foundation.Decimal` has already been through a `Double` by the time JSON hands it over, and Swift
has no ISO 8601 parser for durations, dates without a time, or times without a date. Keeping the
text is the only way to hand back exactly what the service said. The names avoid the Foundation and
standard-library ones deliberately: a generated `Decimal` would be ambiguous with
`Foundation.Decimal` in every file that imports both.

## Inheritance

A Swift struct cannot extend another, so a contract's bases are **flattened** into the generated
struct. `contract C: A & B & { ... }` produces one `struct C` carrying A's fields, then B's, then
its own, with the same later-wins override rule the inheritance validator enforces.

## Read and Input variants

A contract with `readonly` or `writeonly` fields generates two structs: `Name` omits `writeonly`
fields, `NameInput` omits `readonly` ones. A model that only references such a contract gets the
pair too, so a request body never asks for a field the server will reject.

## Codable, spelled out

Every struct carries its own `CodingKeys`, `init(from:)`, and `encode(to:)` rather than relying on
the synthesized ones. That costs some lines and buys exactness — the four field shapes the language
distinguishes each mean something different on the wire:

| `.ck`                  | Absent on the way in | `nil` on the way out  |
| ---------------------- | -------------------- | --------------------- |
| `note?: string`        | stays `nil`          | key omitted           |
| `note: string \| null` | **fails to decode**  | key written as `null` |
| `limit?: int = 20`     | becomes `20`         | always written        |
| `kind: literal("a")`   | **fails to decode**  | always written        |

The synthesized `Codable` cannot express the second row at all, and the third and fourth not at all.
A `literal()` field is also checked when its struct is decoded on its own, which is what makes the
plain-union "first member that parses" rule correct.

## Key casing

A contract's `format(input=)` / `format(output=)` renames the keys **on the wire** without changing
the field names the contract declares. Because each struct writes its own coding halves, the two
directions can differ even on a model that is not split: the decoder follows `output`, and a second
`EncodingKeys` follows `input`.

```swift
private enum CodingKeys: String, CodingKey { case accessToken = "access_token" }
private enum EncodingKeys: String, CodingKey { case accessToken = "AccessToken" }
```

An anonymous object nested inside a renamed contract is hoisted into a struct of its own, which
keeps its declared key names — the hoisting pass records no owner to take the casing from. The
generator warns when it meets one. Name the shape as its own contract to fix it.

## Unions

Neither union form has an anonymous Swift equivalent, so each becomes a named `indirect enum`. Two
shapes are recognised first, because Swift already expresses them: `union(T, null)` is just `T?`,
and a union of string literals is a `String`-backed enum.

**Plain unions** get one payload case per member:

```swift
public indirect enum MV: Codable, Equatable, Sendable {
    case payment(Payment)
    case string(String)
}
```

Decoding tries members in declaration order and takes the first that parses. That is what Zod's
`z.union` does on the server, so the client and the service cannot disagree about a payload both
would accept.

**Discriminated unions** read the tag through a dynamic coding key and hand the same decoder to the
member it names, so the member's own `init(from:)` — literal check included — does the rest:

```swift
public indirect enum PaymentMethod: Codable, Equatable, Sendable {
    case card(Card)
    case bank(Bank)
}
```

Encoding delegates to the member, so the tag stays a real property of it. That keeps the tag on the
wire when a member is posted on its own, and lets one contract belong to several unions.

A discriminated union whose discriminator is an `enum` rather than a `literal` has no tag known at
build time. Those degrade to a raw `JSONValue` with a warning.

## Recursive contracts

A Swift struct cannot contain itself — `struct Node { var parent: Node? }` is rejected as infinitely
sized, with or without a `lazy(...)` marker. A whole-project pass finds every stored property that
closes a cycle of value types and routes it through a generated `Indirect` box, behind a computed
property that keeps the public API and the wire format unchanged:

```swift
private var _parent: Indirect<Node>?
public var parent: Node? {
    get { _parent?.value }
    set { _parent = newValue.map { Indirect($0) } }
}
```

A cycle through an array, a dictionary, or a union enum needs no box: those are already on the heap.

## Anonymous shapes

An inline object, an intersection, a tuple, or an enum used inside a field is given a name from the
model and field that hold it: `contract M { status: enum(a, b) }` produces `enum MStatus`. Names are
unique across the whole project, since every generated file lands in one module.

## Using the client

```swift
let sdk = Acme(
    baseURL: URL(string: "https://api.acme.com")!,
    headers: { ["Authorization": "Bearer \(await tokenStore.current())"] }
)

let payment = try await sdk.billing.getPayment(paymentId: id)
```

Every method is `async throws`. `SdkConfig.headers` is called once per request, so a token can be
refreshed without rebuilding the SDK. All clients share one `SdkHttp`, and therefore one
configuration and one transport.

Supply a `transport` of your own to add logging, retries, or a different HTTP client; the SDK
touches `URLSession` only inside the default `URLSessionTransport`.

A status the contract declares but does not produce a body for raises `SdkError`, which carries the
status, the headers, and the raw body. A non-2xx status the contract _does_ give a meaning to comes
back as a value instead.

Path, query, header, and form values are turned into text by the same coders that would put them in
a JSON body, so a `UUID`, a `Date`, or an enum is spelled identically wherever it appears.

## Response shapes

Most operations declare one status with one body, and the method returns that body. Two contract
shapes change it.

**Declared response headers** pair the body with a typed struct. Values arrive as text and are
converted to the type the contract declares. A required header the service omits raises `SdkError`,
because the caller was promised a value.

```swift
let result = try await sdk.billing.createPayment(body: payment)
result.data          // Payment
result.headers.xRequestId
```

**Several statuses, or several content types**, become a flat enum, so a caller's `switch` is
exhaustive in one level:

```swift
switch try await sdk.billing.getPayment(paymentId: id) {
case .status200(let payment): render(payment)
case .status304: useCache()
}
```

Which statuses come back as a value and which raise is decided by the contract, using the same rule
the router and the other SDKs use: a status with a block, or any 2xx, is one the service produces;
a bare `404:` is the error contract.

## Scaffolding a standalone SDK

`scaffold: true` writes `Package.swift` once. It is **user-owned**: created if absent, never
overwritten, and never removed when the generated tree changes around it. Generated Swift sources
are rewritten every run; this one is yours.

Because it is written once, a later change to `moduleName` does not move the target it declares —
edit the file, or delete it and regenerate.

## Programmatic use

```typescript
import { createSwiftSdkPlugin } from '@contractkit/plugin-swift';

const plugin = createSwiftSdkPlugin({ baseDir: 'clients/swift/' }, process.cwd());
```

Prefer the default export when loading through `contractkit.config.json`; the factory is for
building the plugin in code.

## Status and known limitations

The emitted Swift is built by a real toolchain in the test suite, in Swift 6 language mode with
complete concurrency checking and warnings as errors. Two tests do it:

- `packages/output-tests` builds the package generated from the shared cross-plugin fixtures.
- `tests/toolchain.test.ts` builds the package generated from `tests/fixtures/stress.ck`, which
  holds every construct the generator branches on. It then runs `tests/fixtures/probe.swift`
  against that package. The probe decodes, encodes and round-trips through the generated types,
  and drives the generated client over a mock transport. That catches the bug a compile cannot:
  a struct that builds and then fails on the first real response.

Both skip when `swift` is not on the `PATH`. GitHub's `ubuntu-latest` image has it, so CI runs
them. Unit, snapshot and syntax-sanity tests run everywhere.

Behavioural limitations, all deliberate:

1. An optional-and-nullable field cannot distinguish an absent key from an explicit `null`; both
   arrive as `nil` and are written as an omitted key. The other three field shapes are exact.
2. A union declared inline in an operation's request or response, rather than in a contract, and a
   discriminated union whose discriminator is an `enum`, degrade to `JSONValue`.
3. Only the first declared request content type is used. A multi-mime request collapses to one
   method signature, as it does in the Python and Kotlin SDKs.
4. Clients are grouped per `.ck` file. The TypeScript SDK's `area`/`subarea` nesting is not
   implemented.
5. A key transform does not reach an anonymous object nested inside the renamed contract. It is
   warned about; see **Key casing**.
6. `Int` is 32-bit on watchOS's `arm64_32`; see **Type mapping**.
