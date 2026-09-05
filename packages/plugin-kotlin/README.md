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
