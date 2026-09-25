---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
'@contractkit/plugin-docs': minor
'@contractkit/plugin-python': minor
'@contractkit/plugin-csharp': minor
'@contractkit/plugin-kotlin': minor
'@contractkit/plugin-swift': minor
---

Every generated runtime now accepts exactly the `decimal` strings the published OpenAPI `pattern` does: plain digits, `^-?[0-9]+(\.[0-9]+)?$`. This is a breaking narrowing for anyone sending exponents, hex, `+5`, `.5`, `5.` or non-finite values.

- **core** exports `DECIMAL_PATTERN` and `decimalPattern(scale)`, the single definition every plugin now uses.
- **plugin-typescript**: `_ZodDecimal` and the SDK's `__dec` reviver hand a string to decimal.js only when it matches the pattern, and require a finite value. A bare `decimal` field used to accept `"NaN"`, `"Infinity"`, `"1e5"`, `"0x1F"`, `"+5"` and `"1_000"`. The server now answers those with a 400.
- **plugin-docs**: the `scale=N` pattern allows trailing zeros past the scale (`^-?[0-9]+(\.[0-9]{1,N}0*)?$`), matching the validator, which counts places after trailing zeros are dropped. Previously the spec rejected `"1.10"` at `scale=1` while the server accepted it. `scale=0` now publishes a valid pattern instead of `\d{1,0}`. Patterns are spelled with `[0-9]`, which is equivalent under ECMA-262 and means the same in every SDK language.
- **plugin-python**: a `decimal` field is typed `ExactDecimal`. It reads only plain digit strings (plus an exact `Decimal` or `int` when building a model), and writes plain digits. A `Decimal` in a model, query or header used to go out as `str(value)`, which sends `0.00000001` as `"1E-8"`.
- **plugin-csharp**: `DecimalStringConverter` reads only plain digits, where `NumberStyles.Float` also took exponents, `+` and whitespace. A value past `System.Decimal`'s range raises a `JsonException` instead of an `OverflowException`.
- **plugin-kotlin**: `Decimal` checks its text on construction (`IllegalArgumentException`) and on decoding (`SerializationException`).
- **plugin-swift**: `DecimalValue` throws when decoding or encoding text outside the pattern. `init(_:)` is unchanged.

The TypeScript, Python, C#, Kotlin and Swift codegen versions are bumped, so an existing incremental cache regenerates.
