---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
'@contractkit/plugin-python': minor
'@contractkit/plugin-openapi': minor
'@contractkit/plugin-markdown': minor
'@contractkit/plugin-bruno': minor
'@contractkit/openapi-to-ck': minor
'@contractkit/explorer-ui': minor
---

Add a `decimal` scalar, for money and anything else that has to be exact

`number` compiles to `z.coerce.number()` — an IEEE-754 double. Anything monetary has to be exact,
so contracts either lied about their types or routed the value through `string` by hand. `decimal`
gives the language a type for it:

```
contract Payslip: {
    gross: decimal(min=0, scale=2)
    rate: decimal
}
```

A decimal travels as a **quoted JSON string** (`{"gross": "1250.00"}`) and becomes a decimal.js
`Decimal` — the same class Prisma hands you for a `Decimal` column, so a value moves between the
two with no conversion. Python gets `decimal.Decimal`; OpenAPI gets `type: string, format: decimal`.

A raw JSON number is **rejected**, not coerced. By the time one reaches the schema it has already
been through a double, which is precisely the loss the scalar exists to prevent, so accepting it
would defeat the point silently.

**`scale=` is a validation constraint — at most N decimal places — not a formatting directive.**
It cannot be one: the router assigns `ctx.body` and Koa serializes it with a `JSON.stringify` we
have no replacer for, so the wire form is whatever decimal.js normalizes to and `"1250.00"` reads
back as `"1250"`. The two are the same number; format at the display edge if you need the trailing
zeros. This is also what `scale` means in OpenAPI `pattern`, pydantic `condecimal(decimal_places=)`
and Prisma `@db.Decimal(_, n)`, so every downstream mapping stays honest.

Generated code sets `Decimal.set({ toExpNeg: -9e15, toExpPos: 9e15 })` so values never serialize in
exponential notation — without it `0.00000001` ships as `"1e-8"` and any peer validating
`^-?\d+(\.\d+)?$` rejects it. Note this is global decimal.js configuration and affects every
`Decimal` in the consuming process.

SDK clients rehydrate decimals through generated `reviveX` functions. The `bigint` approach does
not transfer — it works only because bigint invented a tagged `"123n"` wire encoding, and tagging a
decimal would corrupt the format for every non-ContractKit consumer. Re-parsing responses through
the Zod schema is not available either: `XOutput` is a type alias with no runtime value, and models
default to `z.strictObject`, so any field the server added would throw in every deployed client.
The revivers mutate in place, which preserves unknown server-added keys.

Two placements are rejected at parse time, both errors rather than warnings since no existing
contract can be relying on them. A decimal inside an **undiscriminated union** cannot be rehydrated
— the SDK has no way to tell which arm arrived, and a convert-if-string fallback would silently
rewrite a genuine `string` field in a sibling arm. A decimal in a **response header** has no
parsing step at all, so the annotation would simply be false at runtime.

`min`/`max` are kept as exact decimal strings rather than coerced through `Number()`, and OpenAPI
carries them in `x-contractkit-min`/`-max` extensions, since JSON Schema's numeric `minimum` and
`maximum` are ignored on a string type. A contract round-trips through OpenAPI and back with its
bounds intact.

SDKs that scaffold a `package.json` gain `decimal.js` as a dependency when a covered model uses the
scalar. Existing scaffolds are write-once and are not updated, so add it by hand there.
