# @contractkit/plugin-kotlin

ContractKit's Kotlin Multiplatform SDK generator. Emits `kotlinx.serialization` data classes and a
Ktor-based client from `.ck` contract and operation files.

> Work in progress: model generation only. The client generator, response shapes, and the Gradle
> scaffold land in later phases.

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
