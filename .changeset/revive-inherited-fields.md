---
'@contractkit/plugin-typescript': patch
---

Revive the fields a model inherits, so a child of a revivable base defines the reviver its callers import.

`renderOne` in `codegen-revive.ts` walked `model.fields` alone and returned nothing when none of them reached a revivable scalar. Core's `computeModelsWithScalar` follows `bases`, so a child whose only `decimal` or temporal field is inherited was still in `modelsWithDecimal`, and every SDK client returning it wrapped the response in `reviveChild(...)` — a name the types file never defined. Generated output did not compile:

```
src/plugins/plugins.client.ts:2:9: ERROR: No matching export in "src/plugins/types/plugins.types.ts" for import "revivePluginDetail"
```

for `contract PluginDetail: PluginSummary & { … }` where only `PluginSummary` carries a `datetime`. A child with revivable fields of its own compiled, but its reviver silently skipped the inherited ones, so a `DateTime` declared on the base arrived as a string.

A model's reviver now calls each base's reviver first, in declaration order, before walking its own fields — by name, the same way a `ref` field's is, since a cross-file base is already imported beside its type. When a model has nothing of its own to walk, the object local is not declared, so the emitted function is clean under `noUnusedLocals`.

The known multi-base limit is unchanged: `collectExternalRefs` imports only the first base from another file, so a second cross-file base with a revivable field would need its reviver imported by hand, exactly as its type already does.
