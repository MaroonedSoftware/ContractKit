# @contractkit/plugin-kotlin

ContractKit's Kotlin Multiplatform SDK generator. Emits `kotlinx.serialization` data classes and a
Ktor-based client from `.ck` contract and operation files.

> The generated Kotlin has not yet been compiled against a real toolchain. See **Status** below.

## Install

```bash
pnpm add -D @contractkit/cli @contractkit/plugin-kotlin
```

## Configure

`plugins` is an **object** keyed by package name, not an array.

```json
{
    "rootDir": ".",
    "patterns": ["contracts/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-kotlin": {
            "baseDir": "clients/kotlin/",
            "packageName": "com.acme.sdk",
            "sdkName": "AcmeSdk"
        }
    }
}
```

| Option            | Type      | Default             | Meaning                                              |
| ----------------- | --------- | ------------------- | ---------------------------------------------------- |
| `baseDir`         | `string`  | `"kotlin-sdk"`      | Output directory, relative to `rootDir`              |
| `packageName`     | `string`  | `"contractkit.sdk"` | Kotlin package for the generated sources             |
| `sdkName`         | `string`  | `"Sdk"`             | Aggregator class name                                |
| `includeInternal` | `boolean` | `false`             | Emit client methods for operations marked `internal` |
| `scaffold`        | `boolean` | `false`             | Emit Gradle build files once, as user-owned files    |

## Type mapping

| `.ck`                                | Kotlin                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `string`, `email`, `url`, `interval` | `String`                                                                         |
| `number`                             | `Double`                                                                         |
| `int`                                | `Long` (the source language's `int` is a JS safe integer, which overflows `Int`) |
| `bigint`                             | `BigInt` (generated value class over `String`)                                   |
| `decimal`                            | `Decimal` (generated value class over `String`)                                  |
| `boolean`                            | `Boolean`                                                                        |
| `date`, `time`                       | `kotlinx.datetime.LocalDate` / `LocalTime`                                       |
| `datetime`                           | `kotlin.time.Instant`                                                            |
| `duration`                           | `kotlin.time.Duration`                                                           |
| `uuid`                               | `kotlin.uuid.Uuid`                                                               |
| `binary`                             | `ByteArray`                                                                      |
| `unknown`, `json`, `object`          | `JsonElement`                                                                    |
| `array(T)`                           | `List<T>`                                                                        |
| `record(K, V)`                       | `Map<String, V>`                                                                 |
| `tuple(A, B)` / `(A, B, C)`          | `Pair` / `Triple`, serialized as a JSON array                                    |

## Inheritance

Kotlin data classes cannot extend one another, so a contract's bases are **flattened** into the
generated class. `contract C: A & B & { ... }` produces one `data class C` carrying A's fields,
then B's, then its own, with the same later-wins override rule the inheritance validator enforces.

## Read and Input variants

A contract with `readonly` or `writeonly` fields generates two classes: `Name` omits `writeonly`
fields, `NameInput` omits `readonly` ones. A model that only references such a contract gets the
pair too, so a request body never asks for a field the server will reject.

## Programmatic use

```typescript
import { createKotlinSdkPlugin } from '@contractkit/plugin-kotlin';

const plugin = createKotlinSdkPlugin({ baseDir: 'clients/kotlin/' }, process.cwd());
```

Prefer the default export when loading through `contractkit.config.json`; the factory is for
building the plugin in code.

## Unions

A union has no anonymous form in Kotlin, so each one becomes a named `sealed interface` with a
generated serializer. Two shapes are recognised first, because Kotlin already expresses them:
`union(T, null)` is just `T?`, and a union of string literals is an `enum class`.

**Plain unions** wrap each member in a case, so callers get an exhaustive `when`:

```kotlin
@Serializable(with = MVSerializer::class)
sealed interface MV {
    data class OfPayment(val value: Payment) : MV
    data class OfString(val value: String) : MV
}
```

Decoding tries members in declaration order and takes the first that parses. That is what Zod's
`z.union` does on the server, so the client and the service cannot disagree about a payload both
would accept.

**Discriminated unions** are implemented by the member classes directly and dispatch on the tag:

```kotlin
@Serializable(with = PaymentMethodSerializer::class)
sealed interface PaymentMethod

@Serializable
data class Card(val kind: String = "card", val last4: String) : PaymentMethod
```

The discriminator stays a real property defaulted to its literal, rather than being folded into a
kotlinx class discriminator. That keeps the tag on the wire when a member is posted on its own, and
lets one contract belong to several unions. `encodeDefaults` in the SDK's `Json` is what writes it.

A discriminated union whose discriminator is an `enum` rather than a `literal` has no tag known at
build time. Those degrade to a raw `JsonElement` with a warning.

## Anonymous shapes

An inline object, an intersection, or an enum used inside a field is given a name from the model and
field that hold it: `contract M { status: enum(a, b) }` produces `enum class MStatus`. Names are
unique across the whole project, and a collision with a real contract name gets a numeric suffix.

## Using the client

```kotlin
val sdk = AcmeSdk(
    SdkConfig(
        baseUrl = "https://api.acme.com",
        headers = { mapOf("Authorization" to "Bearer ${tokenStore.current()}") },
    ),
)

val payment = sdk.billing.getPayment(paymentId)
sdk.close()
```

Every method is a `suspend fun`. `SdkConfig.headers` is called once per request, so a token can be
refreshed without rebuilding the SDK. Pass your own `httpClient` to bring an engine or Ktor plugins
such as `Auth`, `Logging`, or `HttpRequestRetry`; the SDK then never closes it.

All clients share one `SdkHttp`, and therefore one Ktor `HttpClient` and one connection pool.

A status the contract declares but does not produce a body for raises `SdkError`, which extends
Ktor's own `ResponseException`. A non-2xx status the contract _does_ give a meaning to comes back as
a value instead.

Path, query, header, and form values are turned into text by the same serializer that would put
them in a JSON body, so a `Uuid`, an `Instant`, a `Duration`, or an enum is spelled identically
wherever it appears in a request.

## Response shapes

Most operations declare one status with one body, and the method returns that body. Two contract
shapes change it.

**Declared response headers** pair the body with a typed class. Values arrive as text and are
converted to the type the contract declares. A required header the service omits raises `SdkError`,
because the caller was promised a value.

```kotlin
val result = sdk.billing.createPayment(payment)
result.data          // Payment
result.headers.xRequestId
```

**Several statuses, or several content types**, become a flat sealed interface, so a caller's `when`
is exhaustive in one level:

```kotlin
when (val result = sdk.billing.getPayment(id)) {
    is GetPaymentResponse.Status200 -> render(result.data)
    GetPaymentResponse.Status304 -> useCache()
}
```

Which statuses come back as a value and which raise is decided by the contract, using the same rule
the router and the other SDKs use: a status with a block, or any 2xx, is one the service produces;
a bare `404:` is the error contract.

## Scaffolding a standalone SDK

`scaffold: true` writes `build.gradle.kts`, `settings.gradle.kts`, and `gradle.properties` once.
They are **user-owned**: created if absent, never overwritten, and never removed when the generated
tree changes around them. Generated Kotlin sources are rewritten every run; these are yours.

The scaffold ships a JVM target with the CIO engine. Add the targets you actually ship, and give
each one a Ktor engine of its own — `ktor-client-darwin`, `ktor-client-js`, and so on. Without an
engine on the classpath, `HttpClient()` has none to find at runtime.

Pinned versions live in one object in `src/scaffold.ts`, so a bump is one edit.

## Status and known limitations

The generator is complete and unit-tested, but **the Kotlin it emits has not been compiled**: no
Kotlin toolchain was available where it was written. Run a build against the scaffold before
depending on it, and expect to fix import or API-shape details.

Behavioural limitations, all deliberate:

1. `explicitNulls = false` lets an optional field be omitted, which is what the service's schema
   wants. The same setting omits a _required nullable_ field whose value is null; a strict service
   would reject that. A per-field wrapper is the real fix. The Python SDK has the mirror bug.
2. A `literal()` field is not validated when its class is decoded on its own. Only the union
   serializer checks the tag.
3. A discriminated union whose discriminator is an `enum`, and any union declared inline in an
   operation's request or response rather than in a contract, degrade to `JsonElement`.
4. Only the first declared request content type is used. A multi-mime request collapses to one
   method signature, as it does in the Python SDK.
5. Clients are grouped per `.ck` file. The TypeScript SDK's `area`/`subarea` nesting is not
   implemented.
6. A tuple nested inside a collection falls back to `JsonArray`: the serializer annotation that
   makes `Pair` and `Triple` travel as JSON arrays applies to a property's own type only.
