---
'@contractkit/plugin-typescript': minor
---

Preserve the optional-field modality through `format(input=...)` / `format(output=...)` transforms. Optional fields are now emitted with a conditional spread (`...(data.x !== undefined ? { k: data.x } : {})` for output, `... != null` for input) so the inferred `z.input` / `z.output` type widens the property to `k?: T` instead of required-nullable `k: T | undefined`. Consumer code that constructs values with `...(x ? { k: x } : {})` is now assignable to the schema's inferred type. Runtime wire output is unchanged.
