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
