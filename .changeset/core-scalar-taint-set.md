---
'@contractkit/core': patch
'@contractkit/plugin-typescript': patch
---

Generalise the decimal taint-set helpers over an arbitrary set of scalars.

`typeHasDecimal` and `computeModelsWithDecimal` hardcoded `decimal`, but the question they answer is not specific to it: any scalar whose runtime type differs from what `JSON.parse` produces taints a model the same way, and needs the same transitive answer through referenced models.

Core now exports `typeHasScalar(type, scalars)` and `computeModelsWithScalar(models, scalars, external)`. `computeModelsWithDecimal` stays as a thin wrapper over a one-member set, so every existing caller is untouched. The TypeScript plugin's `ReviveCodegenOptions` gains an optional `revivableScalars`, defaulting to the same one-member set.

Decimal remains the only member and no generated output changes.

One thing settled in passing: core's predicate checks a `record`'s key *and* value while the reviver's checks only the value, and that divergence is correct rather than an oversight. Core answers "is this scalar mentioned", which decides imports, and a `record(decimal, string)` schema does reference the `Decimal` type. The reviver answers "is there a value to rehydrate", and a JSON object key is always a string, so there is nothing at a key position to convert. Both are now documented in place.
