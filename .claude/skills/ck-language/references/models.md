# Contracts: modifiers, inheritance, schema shapes

## Contract modifiers

| Modifier                              | Effect                                   |
| ------------------------------------- | ---------------------------------------- |
| `deprecated`                          | Marks model as deprecated                |
| `mode(strict\|strip\|loose)`          | Controls how Zod handles unknown keys    |
| `format(input=camel\|snake\|pascal)`  | Transforms key casing when parsing input |
| `format(output=camel\|snake\|pascal)` | Transforms key casing on output          |

## Field modifiers

| Modifier                 | Effect                                                                   |
| ------------------------ | ------------------------------------------------------------------------ |
| `?` suffix on field name | Optional field                                                           |
| `readonly`               | Field excluded from Input schema                                         |
| `writeonly`              | Field excluded from Read schema                                          |
| `deprecated`             | Marks field as deprecated                                                |
| `override`               | Required when redeclaring a field that conflicts across bases (see below) |
| `= value`                | Default value (string, number, boolean, or identifier)                   |

Modifiers compose in any order on the source side (`override readonly`,
`readonly override`, `deprecated override readonly`). The prettier printer emits them in
canonical order: **override → deprecated → readonly|writeonly**. `readonly` + `writeonly`
on the same field is a parse-time error.

## Multi-base inheritance

`contract C: A & B & C & D & { ... }` produces `model.bases = ['A', 'B', 'C', 'D']`. Each
base contributes its full **effective** field set (own fields plus its own bases', with
its own overrides applied) — diamond inheritance is deduplicated at resolution time.

`validate-inheritance.ts` runs after `validate-refs` and enforces:

- **Cross-base conflict requires `override`** — if two bases contribute a same-named field
  with non-identical shape, the subclass must redeclare with `override`. Identical
  contributions are silently deduplicated. The shape predicate `fieldsAreIdentical`
  compares type (deep), `optional`, `nullable`, `visibility`, `default`, `deprecated`;
  `description` and `loc` are ignored.
- **`override` must shadow** — `override` on a field name not present in any base is an error.
- **Cycle detection** — `A: B`, `B: A` (or longer chains) emit `Inheritance cycle: ...`
  once per cycle and skip the conflict check for nodes in the cycle.

`override` semantics are **replace, not patch**. The modifier replaces the full field
declaration including visibility, defaults, and optionality — re-add them on the override
line to preserve them (`override readonly int = 0`).

Codegen impact per plugin:

- **Zod**: `Test5 = A.extend(B.shape).extend(C.shape).extend(D.shape).extend({...inline})`.
  Last-wins is the runtime semantics; the inline block is appended last so overrides win.
  The exception is a model whose keys a `format()` renames, its own or inherited from any base:
  a `format()` schema is a pipe with no `.extend()` or `.shape`, so `flattenFormatChain`
  (`codegen-wire-input.ts`) inlines every base's fields into one object, in the same last-wins
  order. It resolves bases through the all-files model map (`ContractCodegenContext.modelMap`),
  so a base in another `.ck` file still contributes, and the generators take imports and scalar
  needs from the flattened models. The plain `XOutput`, the SDK revivers and `XWireInput` all
  follow the same flattened shape.
- **Plain TS** (`codegen-plain-types.ts`): `interface Test5 extends A, B, C, D { ... }`.
  When fields are overridden, each base is wrapped in `Omit<Base, 'a' | 'b'>` — TypeScript's
  `Omit` tolerates omit keys that don't exist on the base, so we omit unconditionally and
  skip any per-base field-set lookup.
- **Python**: `class Test5(A, B, C, D): ...`, Pydantic v2 MRO handles override redeclarations.
- **OpenAPI**: `allOf: [{ $ref: A }, { $ref: B }, { $ref: C }, { $ref: D }, { ...inline }]`.
- **Markdown**: `Extends [\`A\`](#a), [\`B\`](#b), ...`
- **Bruno** uses `resolveModelFields` to flatten the chain with overrides applied; nothing
  user-visible changes.

## Zod schema generation (`codegen-contract.ts`)

Models with visibility modifiers generate up to three schemas:

- **`ModelBase`** — all fields including writeonly (only when writeonly fields exist)
- **`Model`** (Read) — no writeonly fields; extends `ModelBase` when it exists
- **`ModelInput`** — no readonly fields (only when readonly/writeonly fields exist)

`format(input=)` generates a `.transform()` remapping keys from the incoming casing to
camelCase internally. `format(output=)` remaps from camelCase to the output casing. Both
can be combined.

Either one makes the schema a pipe whose `z.input` casing differs from its `z.output`, which
means **it cannot re-parse its own output**. That is why the TypeScript router's
`server.validateResponses` skips any response body that transitively references such a model:
the service already returns the post-transform shape. Note that `modelsWithOutput` is the wrong
set to test for this — it seeds only from `outputCase`, since only that case needs an `Output`
type alias. Use `computeModelsWithCaseTransform`, which covers both directions.

On the wire, a request travels in the `input` casing and a response in the `output` casing.
Every SDK plugin encodes a request body under `format(input=)` and decodes a response under
`format(output=)`. In the TypeScript SDK the model's own type is the wrong request type: for a
Zod SDK it is `z.output` (post-transform keys), and for a plain one it has the declared keys.
So SDK type files emit **`ModelWireInput`**, a rendered interface in the input casing, and
request bodies, query objects and header objects use it. Path params don't, because the URL
reads their fields by declared name. Which models get one is `computeModelsWithWireInput` in
`codegen-wire-input.ts`, and it differs by SDK flavour. A Zod SDK also needs one for a plain
model nesting an output-only model, since `z.infer` gives the nested model's output keys. It is
not `z.input<typeof X>`: that types every coercing scalar (`int`, `datetime`, `decimal`) as
`unknown`.

A model split for `readonly`/`writeonly` applies its `format()` to both schemas: `Model` is the
transform over the readable fields and `ModelInput` over the writable ones, each typed by the same
rule as a single schema (`z.input` when only `output=` is set, else `z.output`), and `ModelOutput`
is `z.output<typeof Model>`. That is what the Swift, Kotlin and C# SDKs expect of the Input twin.
A type alias ignores `format()`. `ModelWireInput` mirrors what the server parses, so it follows
the same rules; `appliedCasing` in `codegen-wire-input.ts` is where the two must agree.

Known gap: an intersection type (a field typed `A & B`, or `contract X: A & B` with no
trailing inline block, which is a type alias rather than inheritance) still renders
`A.extend(B.shape)`, which fails when either side is a `format()` pipe. Inheritance is
flattened; an intersection type is not.

## Discriminated unions

`discriminated(by=<field>, A | B | C)` compiles to `z.discriminatedUnion("field", [...])`
in Zod, `Annotated[Union[...], Field(discriminator=...)]` in Python, and `oneOf` +
`discriminator.mapping` in OpenAPI.

Validated at parse time in `validate-discriminated.ts`: every member must be a model ref
or an inline object containing the discriminator as a `literal()`/`enum()` field, and at
least two members are required. Failures emit **warnings, not errors**.

## Scalar types worth knowing

- `datetime` → Luxon `DateTime`
- `interval` → Luxon `Interval`; `_ZodInterval` parses an ISO 8601 interval string and
  `.transform()`s back to ISO on output
- `bigint` → `z.coerce.bigint()`; the SDK generates bigint-aware JSON helpers in
  `sdk-options.ts`
- `decimal` → decimal.js `Decimal`, for money and anything else that must be exact.
  Travels as a **quoted JSON string**; `_ZodDecimal` **rejects a raw JSON number** rather
  than coercing it, since by then the value has already been through a double. It carries
  no output `.transform()` — unlike `_ZodInterval` — because `isRevalidatable` treats every
  scalar as idempotent under re-parse and `server.validateResponses` depends on that.
  `scale=` is a validation constraint (at most N decimal places), **not** formatting: the
  wire form is decimal.js-normalized, so `"1250.00"` reads back as `"1250"`. The router
  cannot make it otherwise — Koa serializes `ctx.body` with a `JSON.stringify` we have no
  replacer for, which is also why the prelude sets `Decimal.set({ toExpNeg, toExpPos })` to
  keep values out of exponential notation. `min`/`max` are kept as source strings, never
  coerced through `Number()`.
