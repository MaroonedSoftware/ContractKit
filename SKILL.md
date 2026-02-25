---
name: contracts-and-operations
description: >
    Two complementary DSL skills for a TypeScript/Koa API codebase:
    1. **Contracts** — Convert `.dto` DSL files into TypeScript Zod schema files.
       Use when the user defines models in the compact DSL syntax and wants generated
       Zod validation code with inferred TypeScript types.
    2. **Operations** — Convert `.op` DSL files into Koa route handler TypeScript files.
       Use when the user defines API operations in the compact DSL syntax and wants
       generated route handler code with validation, service calls, and proper conventions.
    Both skills share the same Zod v4 type vocabulary and project conventions.
---

# Contracts & Operations DSL Skills

> **Target: Zod v4** — All generated code targets Zod v4. Do not use Zod v3 patterns (e.g. `z.number().int()`, `z.string().email()`).

---

## Table of Contents

1. [Contracts Skill — Zod Schema Generation](#1-contracts-skill--zod-schema-generation)
2. [Operations Skill — Koa Route Handler Generation](#2-operations-skill--koa-route-handler-generation)
3. [Shared Type Vocabulary](#3-shared-type-vocabulary)

---

# 1. Contracts Skill — Zod Schema Generation

This skill converts `.dto` DSL files into production-ready Zod schema files.

---

## DSL Syntax Reference

### Basic field definition

Models use a colon after the name, then curly braces:

```
ModelName: {
    fieldName: type
    optionalField?: type
}
```

### Model inheritance

A model can extend a base model by placing the parent name after a colon on the model header line:

```
ChildModel: BaseModel {
    extraField: string
}
```

When a model extends a base, the child model **inherits all fields** from the parent and adds its own. In the generated output, use `.extend()` on the parent schema:

```typescript
export const ChildModel = BaseModel.extend({
    extraField: z.string(),
});
export type ChildModel = z.infer<typeof ChildModel>;
```

Rules:

- The base model must be defined (in the same file or as a known external model).
- The child schema includes all parent fields plus its own — it is not a partial override.
- If the base model uses the three-schema pattern (`readonly`/`writeonly`), extend from `{Base}Base` (the internal unexported schema) so the child gets all fields, then apply the child's own visibility rules on top.
- Base model must appear before the child in dependency order.

### Scalar types

| DSL type         | Zod output                                                                             |
| ---------------- | -------------------------------------------------------------------------------------- |
| `string`         | `z.string()`                                                                           |
| `number`         | `z.number()`                                                                           |
| `int`            | `z.int()`                                                                              |
| `bigint`         | `z.bigint()`                                                                           |
| `boolean`        | `z.boolean()`                                                                          |
| `date`           | `z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' })` |
| `datetime`       | `z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' })` |
| `email`          | `z.email()`                                                                            |
| `url`            | `z.url()`                                                                              |
| `uuid`           | `z.uuid()`                                                                             |
| `any`            | `z.any()`                                                                              |
| `unknown`        | `z.unknown()`                                                                          |
| `null`           | `z.null()`                                                                             |
| `object`         | `z.record(z.string(), z.unknown())`                                                    |
| `binary`         | `z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' })`   |
| `literal(value)` | `z.literal(value)`                                                                     |
| `ModelName`      | `Model` (reference)                                                                    |

### Type modifiers (in parentheses)

```
fieldName: string(min=1, max=255)       # length bounds
age:       int(min=0, max=120)          # value bounds
score:     number(min=0, max=1)
value:     string(len=32)               # exact length → .length(32)
slug:      string(regex=/[a-z0-9-]+/)   # regex → .regex(/^[a-z0-9-]+$/)  (anchors added automatically)
tags:      array(string)                # array of scalar
tags:      array(string, min=1)         # non-empty array
tags:      array(string, min=1, max=10) # bounded array
members:   array(User)                  # array of model ref
coords:    tuple(number, number)        # fixed-length tuple
labels:    record(string, string)       # map/dict type
counts:    record(string, int)          # map with typed values
status:    enum(active, inactive)       # string enum
balance:   bigint(min=0)               # bigint with lower bound (emits bigint literal: 0n)
ref:       lazy(User)                   # lazy reference for circular deps
```

### Inline object literals (curly braces)

Use `{ ... }` to define an anonymous object type inline within a field expression (e.g. inside a union or as a standalone field type). Fields inside the braces follow the same syntax as regular model fields:

```
currency: string(length=3) | { code: string(length=3), exponent: int }
```

This emits `z.strictObject({ ... })` output. Inline objects are written on a single line using curly braces and commas.

### Comments as descriptions

A `#` comment on a field line or model line becomes a `.describe()` call in the output:

```
# The user who owns the account
User: {
    id: uuid          # Unique identifier
    email: email      # Must be a valid email address
    age?: int         # Age in years
}
```

- A comment on the **model line** (the line preceding the `ModelName {` line) becomes a JSDoc comment block above the schema constant.
- A comment on a **field line** is appended as `.describe("...")` on that field's Zod expression.
- Comments used only for DSL annotation that are purely developer notes and not meaningful descriptions should be omitted from the output — use judgment: if the comment adds user-facing meaning, include it; if it just restates the type, omit it.

### Optionality, nullability, defaults

```
nickname?: string                # optional → .optional()
bio: string | null               # nullable → .nullable()
avatar?: url | null              # optional + nullable → .nullable().optional()
role: string = "user"            # default (string) → .default("user")
active: boolean = true           # default (boolean) → .default(true)
page: int = 1                    # default (number) → .default(1)
nickname?: string = "anonymous"  # optional with default → .default("anonymous") (default replaces .optional())
```

### Read-only and write-only fields

Place `readonly` or `writeonly` after the `:`, immediately before the type and all other modifiers, to mark a field's visibility:

```
User: {
    id: readonly uuid             # server-generated, never accepted as input
    name: string(min=1)
    password: writeonly string    # accepted on write, never returned on read
    createdAt: readonly date      # set by server
}
```

- `readonly` — the field appears in **read (response) schemas only**. It is omitted from the write (input) schema.
- `writeonly` — the field appears in **write (input) schemas only**. It is omitted from the read (response) schema.
- Fields with neither modifier appear in all generated schemas.
- `readonly` and `writeonly` are mutually exclusive — a field cannot have both.
- These modifiers combine freely with `?`, `| null`, and `= default`. The keyword always appears directly after the `:`, before the type.

```
token?: writeonly string              # optional write-only field
deletedAt?: readonly date | null      # optional nullable read-only field
role?: readonly enum(admin, member) = "member"  # optional, with default
```

When any field in a model uses `readonly` or `writeonly`, the skill generates **three exports** for that model instead of one — see the "Read-only / Write-only output pattern" section below.

### Union types

Separate types with `|`:

```
payload: string | number                          # z.union([z.string(), z.number()])
target: email | url                               # z.union([z.email(), z.url()])
mode: literal("prod") | literal("dev")            # z.union([z.literal("prod"), z.literal("dev")])
currency: string(length=3) | CustomCurrency       # z.union([z.string().length(3), CustomCurrency])
```

Union with `null` is sugar for `.nullable()` — do not use `z.union` for nulls, chain `.nullable()` instead.

### Circular / mutual references

When two models reference each other, use `lazy()` to wrap the referencing type:

```
Post: {
    id: uuid
    author: lazy(User)
}

User: {
    id: uuid
    posts: array(lazy(Post))
}
```

The `lazy()` wrapper emits `z.lazy(() => ...)` in the output.

---

## Output Format

For each model, generate:

1. `export const {Model} = z.strictObject({ ... })`
2. `export type {Model} = z.infer<typeof {Model}>`
3. A single `import { z } from 'zod';` at the top
4. `import { DateTime } from 'luxon';` at the top **if any field uses the `date` or `datetime` type**

### Source location comments

Each model emits a source location comment before its declaration:

```typescript
// from ModelName (filename.dto:42)
export const ModelName = z.strictObject({
    ...
});
```

### Import extensions

When the generated file imports from other **local** files, always append `.dto.js` to the relative import path. External model references are imported using PascalCase-to-dot-case conversion:

```typescript
// ✅ correct — PascalCase "CounterpartyAccount" → dot-case "counterparty.account"
import { CounterpartyAccount } from './counterparty.account.dto.js';

// ✅ correct — single word
import { Address } from './address.dto.js';
```

This rule applies only to relative imports (`./`, `../`). Third-party package imports (e.g. `'zod'`) are left as-is.

Models must be emitted in dependency order (dependencies first).

### Output file path

When the user provides a DSL file path, derive the output `.ts` file path using this mapping:

| DSL path segment    | Output path segment |
| ------------------- | ------------------- |
| `/contracts/types/` | `/src/`             |
| `.dto` (extension)  | `.ts`               |

The output file is placed in a `types/` subdirectory at the module level.

**Examples:**

- `contracts/types/modules/ledger/create.account.dto` → `src/modules/ledger/types/create.account.ts`
- `contracts/types/modules/transfers/counterparty.dto` → `src/modules/transfers/types/counterparty.ts`
- `contracts/types/shared/pagination.dto` → `src/shared/types/pagination.ts`

If no path is provided, ask the user where the `.dto` file lives, or default to writing the output as `types.ts` in the current directory.

---

## Chaining order

Always apply chainers in this order:

1. Base type (e.g. `z.string()`, `z.int()`, `z.bigint()`)
2. Value/length constraints: `.min()`, `.max()`, `.length()`, `.regex()`
3. `.nullable()` — if nullable
4. `.default(value)` — if a default is set (replaces `.optional()`)
5. `.optional()` — if optional (`?`) and no default
6. `.describe("...")` — always last, if a comment is present

> **Note:** `.default()` and `.optional()` are mutually exclusive — a field with a default value does not also get `.optional()`, because the default already handles the missing-value case.

> **Note:** `date`/`datetime` fields use `z.custom<DateTime>(...)` and do not follow the constraint chaining — constraints are not applicable to custom validators.

---

## Type mapping rules (detailed)

### `literal(value)`

- Number value → `z.literal(42)`
- String value (quoted or unquoted) → `z.literal("production")`
- Boolean value → `z.literal(true)`

### `enum(a, b, c)`

→ `z.enum(["a", "b", "c"])` — all values are strings.

### `array(type)`

→ `z.array(z.string())` for scalars, `z.array(User)` for model refs

- `array(type, min=N)` → `.min(N)` on the array
- `array(type, max=N)` → `.max(N)` on the array

### `tuple(t1, t2, ...)`

→ `z.tuple([z.number(), z.number()])` — each element follows normal type rules.

### `record(keyType, valueType)`

→ `z.record(z.string(), z.string())`

- `record(string, int)` → `z.record(z.string(), z.int())`

### `object`

An unstructured object / generic map type:

→ `z.record(z.string(), z.unknown())`

Use when the field accepts arbitrary key-value data (e.g. metadata blobs).

### `int`

In Zod v4, `int` maps to the top-level `z.int()` function — **not** `z.number().int()`. The old form is deprecated.

| DSL type | Zod v4 output | TypeScript type | Range              |
| -------- | ------------- | --------------- | ------------------ |
| `int`    | `z.int()`     | `number`        | safe integer range |

> **Never emit** `z.number().int()` — this is the Zod v3 pattern and will be removed in v5.

### `bigint`

The DSL `bigint` type maps directly to `z.bigint()`. Constraints use bigint literal syntax with the `n` suffix:

**Basic usage:**

```
balance: bigint          →  z.bigint()
```

**Modifiers** — `min`/`max` constraints are chained directly:

```
balance: bigint(min=0)          →  z.bigint().min(0n)
balance: bigint(min=0, max=100) →  z.bigint().min(0n).max(100n)
```

**Chaining after constraints** — `.nullable()`, `.optional()`, `.default()`, and `.describe()` go after the constraints:

```
balance: bigint(min=0)?         →  z.bigint().min(0n).optional()
balance?: bigint                →  z.bigint().optional()
```

Always append `n` to numeric constraint values for `bigint` fields.

### `email`, `uuid`, `url`

In Zod v4 these are **top-level functions**, not `.string()` methods. Always emit:

- `email` → `z.email()` _(not `z.string().email()`)_
- `uuid` → `z.uuid()` _(not `z.string().uuid()`)_
- `url` → `z.url()` _(not `z.string().url()`)_

The method forms are deprecated in Zod v4 and will be removed in v5. These top-level types cannot be chained with string-specific methods like `.min()` or `.regex()`. If you need length or pattern constraints on an email/url field, use `z.string()` with the appropriate refinements.

> **UUID strictness:** `z.uuid()` in Zod v4 enforces RFC 9562/4122 variant bits. For a more permissive "any UUID-like hex pattern" validator, use `z.guid()`.

### `date` / `datetime` type — Luxon `DateTime`

The `date` and `datetime` DSL types map to a Luxon `DateTime` custom validator. Do **not** use `z.coerce.date()` or `z.string().transform()`.

Emit a custom schema that validates the value is a `DateTime` instance:

```typescript
z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' })
```

The inferred TypeScript type for a `date` field is `DateTime` (from luxon), **not** `Date`.

**Modifiers on `date` fields** — wrap the custom validator in `.nullable()`, `.optional()`, or `.describe()` at the schema level:

```typescript
// optional date field
createdAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).optional(),

// nullable date field
deletedAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).nullable(),
```

Always add `import { DateTime } from 'luxon';` to the file header when any `date` or `datetime` field is present.

### `binary` type

The `binary` DSL type maps to a custom Buffer validator:

```typescript
z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' })
```

Used for binary/file data fields, typically in multipart upload scenarios.

### `lazy(type)`

→ `z.lazy(() => renderType(inner))`

Used to break circular references between models.

### Union types (`|`)

- Split on `|`, trim each part
- Strip any `null` members — instead chain `.nullable()` on the result
- If 1 non-null member: just that type expression (+ `.nullable()` if null was present)
- If 2+ non-null members: `z.union([...members])` (+ `.nullable()` if null was present)

### `string(regex=...)` and `string(len=N)`

- `regex` → extract the regex literal and emit `.regex(/^pattern$/)` — the `^` and `$` anchors are **added automatically** by the codegen. Write the pattern without anchors in the DSL: `regex=/[a-z]+/`.
- `len=N` (or `length=N`) → emit `.length(N)` instead of `.min()` / `.max()`

### Comments → `.describe()`

- Strip the `#` and trim whitespace from the comment text
- Append `.describe("comment text")` as the final chainer on the field expression
- For model-level comments, emit a JSDoc block directly above the `export const` line:
    ```typescript
    /** The user who owns the account */
    export const User = z.strictObject({ ... });
    ```
- Omit `.describe()` if the comment only restates the type — only include comments that add meaningful context

---

## Read-only / Write-only output pattern

When a model has any `readonly` or `writeonly` fields, emit **three** named schemas as separate `z.strictObject()` calls:

1. `{Model}Base` — internal, unexported, contains all fields.
2. `{Model}` — the **read / response** schema: contains all fields except `writeonly` ones.
3. `{Model}Input` — the **write / request** schema: contains all fields except `readonly` ones.

Each schema is a standalone `z.strictObject()` with its own field list — they are **not** derived from the base via `.omit()`.

```typescript
// from User (user.dto:5)
// ---- internal base (not exported) ----
const UserBase = z.strictObject({
    id: z.uuid(),
    name: z.string().min(1),
    email: z.email(),
    password: z.string(),
    createdAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }),
});

// ---- read schema: excludes writeonly fields ----
export const User = z.strictObject({
    id: z.uuid(),
    name: z.string().min(1),
    email: z.email(),
    createdAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }),
});
export type User = z.infer<typeof User>;

// ---- write schema: excludes readonly fields ----
export const UserInput = z.strictObject({
    name: z.string().min(1),
    email: z.email(),
    password: z.string(),
});
export type UserInput = z.infer<typeof UserInput>;
```

### Naming conventions

| Schema | Export name    | Purpose                     |
| ------ | -------------- | --------------------------- |
| Base   | `{Model}Base`  | Internal only — never export |
| Read   | `{Model}`      | API responses, GET payloads |
| Write  | `{Model}Input` | POST/PUT request bodies     |

### Rules

- If a model has **no** `readonly`/`writeonly` fields, emit the normal single-schema pattern.
- `{Model}Base` is always `const` (not `export const`) — it is an implementation detail.
- The read schema keeps the model's plain name (`User`, not `UserResponse`) so it remains the canonical type.
- When another model references this model as a field type, use the **read schema name** as the field type.
- When the model has a base model (inheritance), the Base uses `.extend()` on the parent's Base:
    ```typescript
    const ChildBase = ParentBase.extend({
        extraField: z.string(),
    });
    ```

### Interaction with `z.lazy()`

`.omit()` does not work through `z.lazy()`. If a model with `readonly`/`writeonly` fields is also involved in a circular reference, write out separate `z.strictObject()` definitions manually. Add a `// NOTE: manual split due to circular reference` comment.

---

## Circular reference output pattern

Use `z.lazy()` to handle circular references. The `lazy()` wrapper in the DSL emits `z.lazy(() => Type)` in the output:

```typescript
import { z } from 'zod';

export const Post = z.strictObject({
    id: z.uuid(),
    author: z.lazy(() => User),
});
export type Post = z.infer<typeof Post>;

export const User = z.strictObject({
    id: z.uuid(),
    posts: z.array(z.lazy(() => Post)),
});
export type User = z.infer<typeof User>;
```

Rules:

- The back-edge field uses `z.lazy(() => Other)`
- Since `z.infer` may not work through `z.lazy`, you may need to write the TypeScript type manually as a type alias if inference fails

---

## FromDb schema pattern

Every model generates an additional `{Model}FromDb` export — a Zod schema that parses raw database rows into the model's application type. This is used in repository classes to bridge the database layer and the application layer:

```typescript
const row = await db.selectFrom('users').selectAll().executeTakeFirstOrThrow();
return UserFromDb.parse(row);
```

The `FromDb` schema:

- Mirrors the model's field structure **without validation constraints** (no `.min()`, `.max()`, `.length()`, `.regex()`)
- Adds field-level `.transform()` for types that need coercion from their database representation
- Omits `.default()` values (database rows always contain concrete values)
- Preserves `.optional()` and `.nullable()` modifiers
- Omits `.describe()` comments
- Includes **all fields** regardless of `readonly`/`writeonly` visibility (database rows contain every column)

### FromDb type mapping

| DSL type             | FromDb Zod expression                                      |
| -------------------- | ---------------------------------------------------------- |
| `string`, `string()` | `z.string()`                                               |
| `number`, `number()` | `z.number()`                                               |
| `int`, `int()`       | `z.number()`                                               |
| `bigint`, `bigint()` | `z.string().transform((s) => BigInt(s))`                   |
| `boolean`            | `z.boolean()`                                              |
| `date` / `datetime`  | `z.date().transform((d) => DateTime.fromJSDate(d))`        |
| `email`              | `z.string()`                                               |
| `url`                | `z.string()`                                               |
| `uuid`               | `z.string()`                                               |
| `enum(a, b, c)`      | `z.enum(["a", "b", "c"])`                                  |
| `literal(value)`     | `z.literal(value)`                                         |
| `null`               | `z.null()`                                                 |
| `any` / `unknown`    | `z.any()` / `z.unknown()`                                  |
| `object`             | `z.record(z.string(), z.unknown())`                        |
| `binary`             | `z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' })` |
| `ModelRef`           | `ModelRefFromDb`                                           |
| `array(T)`           | `z.array(TFromDb)` — apply FromDb mapping to the element   |
| `tuple(T1, T2)`      | `z.tuple([T1FromDb, T2FromDb])`                            |
| `record(K, V)`       | `z.record(KFromDb, VFromDb)`                               |
| `lazy(T)`            | `z.lazy(() => TFromDb)`                                    |
| inline `{ ... }`     | `z.strictObject({...})` using FromDb field types            |

### FromDb chaining order

1. Base type (FromDb mapped — e.g. `z.string()`, `z.number()`, `z.date()`)
2. `.transform()` — if the type needs coercion (bigint, date/datetime)
3. `.nullable()` — if nullable
4. `.optional()` — if optional (`?`)

> No `.min()`, `.max()`, `.length()`, `.regex()`, `.default()`, or `.describe()` in FromDb schemas.

### Rules

- The `FromDb` schema is always a **single export** per model — no separate Read/Write/Input variants.
- For models using the three-schema pattern (readonly/writeonly), the `FromDb` includes **all fields** from the Base schema.
- Union types follow the same structure as the main schema but with FromDb member types. Union with `null` is still `.nullable()`.
- The `FromDb` export name is always `{Model}FromDb` (e.g. `LedgerAccountFromDb`, `PaginationQueryFromDb`).
- No type export is emitted for `FromDb` — it is used as a runtime parser only via `.parse(row)`.
- Emit `{Model}FromDb` immediately after the model's main schema exports (after the `type` export, or after the `Input` type export for three-schema models).
- Source location comment format: `// fromDb ModelName (filename.dto:line)`

### Example

DSL input:

```
User: {
    id: readonly uuid
    name: string(min=1, max=100)
    email: email
    balance: bigint(min=0)
    createdAt: readonly datetime
    deletedAt?: readonly datetime | null
}
```

Generated `FromDb` schema (emitted after the main User/UserInput exports):

```typescript
// fromDb User (user.dto:1)
export const UserFromDb = z.strictObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    balance: z.string().transform((s) => BigInt(s)),
    createdAt: z.date().transform((d) => DateTime.fromJSDate(d)),
    deletedAt: z.date().transform((d) => DateTime.fromJSDate(d)).nullable().optional(),
});
```

---

## Contracts Instructions

When given DSL input:

1. **Parse each model** — identify model name, base model (if inheriting), fields, types, modifiers, optionality, defaults, and `readonly`/`writeonly` annotations. Models use `ModelName: { ... }` syntax (colon before the opening brace). Inherited models use `ChildModel: BaseModel { ... }` (the colon separates child from parent, no additional colon before `{`).
2. **Handle inline objects** — if a field uses `{ key: type, ... }` curly-brace syntax, it's an inline `z.strictObject({...})`.
3. **Handle inheritance** — if a model has a base model (`ModelName: BaseModel { ... }`), use `.extend()` on the parent schema instead of a standalone `z.strictObject()`.
4. **Resolve references** — if a field type is a known model name, use `{Model}`.
5. **Handle lazy references** — if a field uses `lazy(Model)`, emit `z.lazy(() => Model)`.
6. **Order output** — emit models in dependency order (dependencies first).
7. **Build each field expression** using the chaining order: base → constraints → nullable → default/optional → describe.
8. **Handle unions** — split on `|`, isolate `null` into `.nullable()`, wrap 2+ non-null parts in `z.union([...])`.
9. **Handle `object` type** — emit `z.record(z.string(), z.unknown())` for generic metadata/arbitrary-object fields.
10. **Handle `readonly`/`writeonly`** — if any field in a model carries either annotation, emit the three-schema pattern with separate `z.strictObject()` calls for Base (all fields), Read (excludes writeonly), and Input (excludes readonly).
11. **Emit `{Model}FromDb`** — for every model, emit a `FromDb` schema after the model's main exports. Use the FromDb type mapping (no constraints, with `.transform()` for date/datetime and bigint). Include all fields regardless of readonly/writeonly visibility. See the "FromDb schema pattern" section.
12. **Emit a `.ts` file** — derive the output path from the DSL file path using the path mapping rules above, then write the file. If the user just wants it printed, skip writing.
13. **Emit source location comments** — add `// from ModelName (file:line)` before each model and `// fromDb ModelName (file:line)` before each FromDb schema.
14. **Warn on unknowns** — if a type is unrecognized and not a model name, emit `z.unknown()` with a `// TODO` comment.

---

## Contracts Full Example

### DSL input

```
PaginationQuery: {
    page: int(min=0) = 0 # Page number
    pageSize: int(min=1, max=100) = 25 # Page size
    sort: enum(asc, desc) = "desc" # Sort order
}

CustomCurrency: {
    code: string(length=3) # ISO currency code
    exponent: int # Currency exponent
}

CreateAccountInput: {
    name: string(min=3, max=100) # Account name
    normality: enum(credit, debit) # Account normality
    currency: string(length=3) | CustomCurrency # Currency code or custom currency
    description?: string(max=1024) # Optional account description
}

# The primary ledger account entity
LedgerAccount: {
    id: readonly uuid # The account identifier
    name: string(min=3, max=100) # Account name
    normality: enum(credit, debit) # Account normality
    currency: string(length=3) | { code: string(length=3), exponent: int } = "USD" # Currency code or custom currency
    description?: string(max=1024) # Optional account description
    createdAt: readonly datetime # The account creation date
    updatedAt: readonly datetime # The account last update date
    version: readonly int # The account version
}
```

### Generated output

```typescript
import { z } from 'zod';
import { DateTime } from 'luxon';

// from PaginationQuery (ledger.dto:1)
export const PaginationQuery = z.strictObject({
    page: z.int().min(0).default(0).describe('Page number'),
    pageSize: z.int().min(1).max(100).default(25).describe('Page size'),
    sort: z.enum(['asc', 'desc']).default('desc').describe('Sort order'),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

// from CustomCurrency (ledger.dto:7)
export const CustomCurrency = z.strictObject({
    code: z.string().length(3).describe('ISO currency code'),
    exponent: z.int().describe('Currency exponent'),
});
export type CustomCurrency = z.infer<typeof CustomCurrency>;

// from CreateAccountInput (ledger.dto:12)
export const CreateAccountInput = z.strictObject({
    name: z.string().min(3).max(100).describe('Account name'),
    normality: z.enum(['credit', 'debit']).describe('Account normality'),
    currency: z.union([z.string().length(3), CustomCurrency]).describe('Currency code or custom currency'),
    description: z.string().max(1024).optional().describe('Optional account description'),
});
export type CreateAccountInput = z.infer<typeof CreateAccountInput>;

// from LedgerAccount (ledger.dto:19)
/** The primary ledger account entity */
const LedgerAccountBase = z.strictObject({
    id: z.uuid().describe('The account identifier'),
    name: z.string().min(3).max(100).describe('Account name'),
    normality: z.enum(['credit', 'debit']).describe('Account normality'),
    currency: z
        .union([
            z.string().length(3),
            z.strictObject({
                code: z.string().length(3),
                exponent: z.int(),
            }),
        ])
        .default('USD')
        .describe('Currency code or custom currency'),
    description: z.string().max(1024).optional().describe('Optional account description'),
    createdAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).describe('The account creation date'),
    updatedAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).describe('The account last update date'),
    version: z.int().describe('The account version'),
});

// ---- read schema: excludes writeonly fields ----
export const LedgerAccount = z.strictObject({
    id: z.uuid().describe('The account identifier'),
    name: z.string().min(3).max(100).describe('Account name'),
    normality: z.enum(['credit', 'debit']).describe('Account normality'),
    currency: z
        .union([
            z.string().length(3),
            z.strictObject({
                code: z.string().length(3),
                exponent: z.int(),
            }),
        ])
        .default('USD')
        .describe('Currency code or custom currency'),
    description: z.string().max(1024).optional().describe('Optional account description'),
    createdAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).describe('The account creation date'),
    updatedAt: z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be a Luxon DateTime' }).describe('The account last update date'),
    version: z.int().describe('The account version'),
});
export type LedgerAccount = z.infer<typeof LedgerAccount>;

// ---- write schema: excludes readonly fields ----
export const LedgerAccountInput = z.strictObject({
    name: z.string().min(3).max(100).describe('Account name'),
    normality: z.enum(['credit', 'debit']).describe('Account normality'),
    currency: z
        .union([
            z.string().length(3),
            z.strictObject({
                code: z.string().length(3),
                exponent: z.int(),
            }),
        ])
        .default('USD')
        .describe('Currency code or custom currency'),
    description: z.string().max(1024).optional().describe('Optional account description'),
});
export type LedgerAccountInput = z.infer<typeof LedgerAccountInput>;

// fromDb PaginationQuery (ledger.dto:1)
export const PaginationQueryFromDb = z.strictObject({
    page: z.number(),
    pageSize: z.number(),
    sort: z.enum(['asc', 'desc']),
});

// fromDb CustomCurrency (ledger.dto:7)
export const CustomCurrencyFromDb = z.strictObject({
    code: z.string(),
    exponent: z.number(),
});

// fromDb CreateAccountInput (ledger.dto:12)
export const CreateAccountInputFromDb = z.strictObject({
    name: z.string(),
    normality: z.enum(['credit', 'debit']),
    currency: z.union([z.string(), CustomCurrencyFromDb]),
    description: z.string().optional(),
});

// fromDb LedgerAccount (ledger.dto:19)
export const LedgerAccountFromDb = z.strictObject({
    id: z.string(),
    name: z.string(),
    normality: z.enum(['credit', 'debit']),
    currency: z.union([
        z.string(),
        z.strictObject({
            code: z.string(),
            exponent: z.number(),
        }),
    ]),
    description: z.string().optional(),
    createdAt: z.date().transform((d) => DateTime.fromJSDate(d)),
    updatedAt: z.date().transform((d) => DateTime.fromJSDate(d)),
    version: z.number(),
});
```

---

# 2. Operations Skill — Koa Route Handler Generation

This skill converts a compact operations DSL (`.op` files) into production-ready Koa route handler files.

---

## DSL Syntax Reference

### File structure

An `.op` file defines one or more route groups. Each group starts with a path, followed by a curly-brace block containing HTTP method blocks:

```
/path/to/resource {
    get: {
        ...
    }
    post: {
        ...
    }
}

/path/to/resource/:paramId {
    params: {
        paramId: uuid
    }
    get: {
        ...
    }
    delete: {
        ...
    }
}
```

### Path declaration

Paths follow Koa router syntax with colon-prefixed params. The path is followed by a `{` to open the route block:

```
/ledger/accounts {
/ledger/accounts/:accountId {
/ledger/accounts/:accountId/balances {
/ledger/categories/:categoryId/children/:childId {
```

### HTTP method block

Each path contains one or more method blocks (`get:`, `post:`, `put:`, `patch:`, `delete:`):

```
/ledger/accounts {
    post: {
        request: {
            application/json: CreateAccountInput
        }
        response: {
            201: {
                application/json: LedgerAccount
            }
        }
    }
    get: {
        query: Pagination
        response: {
            200: {
                application/json: array(LedgerAccount)
            }
        }
    }
}

/ledger/accounts/:accountId {
    params: {
        accountId: uuid
    }
    get: {
        response: {
            200: {
                application/json: LedgerAccount
            }
        }
    }
}
```

A bare method with no body is also valid: `get` (no braces needed if there are no properties).

### Comments

Inline comments start with `#` and extend to the end of the line. They are ignored during parsing but may be associated with the following route or operation as a description.

### Method block properties

**Path-level properties** (siblings to method blocks):

| Property | Purpose                          | Example                     |
| -------- | -------------------------------- | --------------------------- |
| `params` | Path parameter type declarations | `params` block (see below) |

**Method block properties** (nested inside a method):

| Property   | Purpose                                  | Example                                     |
| ---------- | ---------------------------------------- | ------------------------------------------- |
| `service`  | Override the service class and/or method | `service: LedgerService.getAccountBalances` |
| `headers`  | Request header declarations              | `headers` block (see below)                |
| `query`    | Query parameter schema reference         | `query: Pagination` or `query: { ... }`    |
| `request`  | Request body definition                  | `request` block (see below)                |
| `response` | Response definition                      | `response` block (see below)               |

---

### Path params (`params`)

Params must be explicitly declared in a `params` block at the **path level** (sibling to method blocks, not nested inside them). Two forms are supported:

**Inline block form:**
```
/ledger/accounts/:accountId/balances {
    params: {
        accountId: uuid
    }
    get: {
        query: GetAccountBalancesQuery
        response: {
            200: {
                application/json: AccountBalances
            }
        }
    }
}
```

**Type reference form:**
```
/ledger/accounts/:accountId {
    params: RouteParams
    get
}
```

| Type     | Zod schema   |
| -------- | ------------ |
| `uuid`   | `z.uuid()`   |
| `string` | `z.string()` |
| `int`    | `z.int()`    |

**Default:** any undeclared `:paramName` is assumed `z.string()`. Always declare params explicitly to get proper validation.

**Generated code (inline block form):**

```typescript
const { accountId } = await parseAndValidate(
    ctx.params,
    z.strictObject({
        accountId: z.uuid(),
    }),
);
```

**Generated code (type reference form):**

```typescript
const params = await parseAndValidate(ctx.params, RouteParams);
```

**Path-level scope:** The `params` block is declared once per path and shared by all method blocks under that path. Individual methods do not redeclare params.

---

### Request headers (`headers`)

Declare expected request headers. Two forms are supported:

**Inline block form:**
```
headers: {
    x-correlate-id: uuid
    x-request-id: uuid
}
```

**Type reference form:**
```
headers: RequestHeaders
```

| Type     | Zod schema   |
| -------- | ------------ |
| `uuid`   | `z.uuid()`   |
| `url`    | `z.url()`    |
| `string` | `z.string()` |

**Generated code (inline block form):**

```typescript
const { x-correlate-id, x-request-id } = await parseAndValidate(
    ctx.headers,
    z.object({
        x-correlate-id: z.uuid(),
        x-request-id: z.uuid(),
    }).passthrough(),
);
```

Note: Headers use `z.object().passthrough()` (not `z.strictObject()`) to allow unknown headers through.

---

### Query parameters (`query`)

Two forms are supported:

**Type reference form:**
```
query: Pagination
```

**Inline block form:**
```
query: {
    page: int
    limit: int
}
```

**Generated code (type reference):**

```typescript
const query = await parseAndValidate(ctx.query, Pagination);
```

**Generated code (inline block):**

```typescript
const { page, limit } = await parseAndValidate(
    ctx.query,
    z.strictObject({
        page: z.int(),
        limit: z.int(),
    }),
);
```

---

### Request body (`request`)

**JSON body:**

```
request: {
    application/json: CreateAccountInput
}
```

Generates:

1. `bodyParserMiddleware(['json'])` as route middleware
2. `const body = await parseAndValidate(ctx.body, CreateAccountInput);`

**Multipart/form-data (file upload):**

```
request: {
    multipart/form-data: binary
}
```

Generates:

1. `bodyParserMiddleware(['multipart'])` as route middleware
2. `const multipartBody = ctx.body as MultipartBody;`

---

### Response (`response`)

| Status        | Behavior                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `200` / `201` | `const result: ResponseType = await service.method(...); ctx.status = N; ctx.type = 'application/json'; ctx.body = result;` |
| `204`         | `ctx.status = 204;` — no body, no content-type, no `result`                                                                 |
| `4xx` / `5xx` | Documentation-only — no generated handler code                                                                              |

**Response type annotation:**

| DSL                    | TypeScript annotation                                     |
| ---------------------- | --------------------------------------------------------- |
| `LedgerAccount`        | `const result: LedgerAccount = await service.method(...)` |
| `array(LedgerAccount)` | `const result: LedgerAccount[] = await service.method(...)` |
| `string` / `number`    | `const result: string = await service.method(...)`        |

No `parseAndValidate` is used on the service return value — the type annotation provides compile-time safety.

---

### Service override (`service`)

**Class + method** — overrides both the service class and method name using dot notation:

```
service: LedgerService.getAccountBalances
```

---

## Convention-Based Inference

### Service class

Derived from the **filename** (not the path): PascalCase each dot-separated segment, join, append `Service`.

| Filename                    | Service class             |
| --------------------------- | ------------------------- |
| `ledger.op`                 | `LedgerService`           |
| `ledger.categories.op`      | `LedgerCategoriesService` |
| `transfers.op`              | `TransfersService`        |

Import path: kebab-case the service name (minus `Service` suffix) → `#modules/{kebab}/{kebab}.service.js`.

| Service class             | Import path                                     |
| ------------------------- | ----------------------------------------------- |
| `LedgerService`           | `#modules/ledger/ledger.service.js`             |
| `LedgerCategoriesService` | `#modules/ledger-categories/ledger-categories.service.js` |

### Method name

The default method name is inferred from the HTTP verb and whether the path contains a parameter:

| HTTP verb | Has `:param` in path | Inferred method |
| --------- | -------------------- | --------------- |
| `GET`     | No                   | `list`          |
| `GET`     | Yes                  | `getById`       |
| `POST`    | —                    | `create`        |
| `PUT`     | —                    | `replace`       |
| `PATCH`   | —                    | `update`        |
| `DELETE`  | —                    | `delete`        |

**Convention inference is best-effort.** The `service:` override should be used for any non-standard naming.

---

## Output Format

### File path and router name

| DSL path                                      | Output path                                |
| --------------------------------------------- | ------------------------------------------ |
| `contracts/operations/ledger.op`              | `src/routes/ledger.router.ts`              |
| `contracts/operations/ledger.transactions.op` | `src/routes/ledger.transactions.router.ts` |

Router name: PascalCase each dot-separated filename segment (without `.op`), join, append `Router`.

| Output file                     | Router name                |
| ------------------------------- | -------------------------- |
| `ledger.router.ts`              | `LedgerRouter`             |
| `ledger.transactions.router.ts` | `LedgerTransactionsRouter` |
| `transfers.router.ts`           | `TransfersRouter`          |

### Imports

Order:

1. Third-party (`zod`, `luxon`, etc.)
2. Framework (`@maroonedsoftware/koa`)
3. Marooned packages (`@maroonedsoftware/multipart`, etc.)
4. Service imports (`#modules/...`)
5. Type imports (`#modules/.../types/index.js` or `#shared/types/index.js`)
6. Shared utilities (`#src/shared/validator.js`)

**Include only when needed:**

| Condition                                                | Import                                              |
| -------------------------------------------------------- | --------------------------------------------------- |
| Any params, headers, query, or body validation           | `z` from `zod`                                      |
| Any `request: application/json` or `multipart/form-data` | `bodyParserMiddleware` from `@maroonedsoftware/koa` |
| Any `request: multipart/form-data`                       | `MultipartBody` from `@maroonedsoftware/multipart`  |
| Any params, headers, query, or body validation           | `parseAndValidate` from `#src/shared/validator.js`  |
| Any `DateTime` usage                                     | `DateTime` from `luxon`                             |

All local imports use `.js` extensions (ESM).

### Type import resolution

Types are defined by the **contracts skill** in `.dto` files under `contracts/types/`. Import from the module barrel, never from individual files:

- `contracts/types/modules/{module}/` → `#modules/{module}/types/index.js`
- `contracts/types/shared/` → `#shared/types/index.js`

The module is derived from the first segment of the op filename:

| Filename               | Type import                          |
| ---------------------- | ------------------------------------ |
| `ledger.categories.op` | `#modules/ledger/types/index.js`     |
| `transfers.op`         | `#modules/transfers/types/index.js`  |

If the source `.dto` file cannot be found, fall back to the module barrel inferred from the filename and add a `// TODO: verify import path` comment.

## Operations Instructions

When given DSL input:

1. **Parse the `.op` file** — read each path group and method block. Strip inline `# comments` from values. Block declarations use a colon before the opening brace (e.g. `get: {`, `params: {`, `response: {`, `201: {`). Route path declarations do not use a colon (e.g. `/path {`).
2. **Determine output path** — map `contracts/operations/{name}.op` → `src/routes/{name}.router.ts`.
3. **Derive router name** — PascalCase the dot-separated filename segments, join, append `Router`.
4. **Collect imports** — scan all method blocks for needed imports: `z`, `bodyParserMiddleware`, service class, type schemas, `parseAndValidate`, `MultipartBody`, `DateTime`. Resolve type import paths via the contracts skill's `.dto` files.
5. **Resolve service class and method** — if `service:` is declared (e.g. `service: LedgerService.updateCategoryMembership`), use the class from before the dot and the method from after. Otherwise infer the service class from the filename and the method name from the HTTP verb + whether the path has a param.
6. **Generate header validation** — if `headers` block is declared, validate against `ctx.headers` with `z.object({...}).passthrough()`.
7. **Generate param validation** — for each `:paramName`, build an inline `z.strictObject()` and validate with `parseAndValidate(ctx.params, schema)`. Use the type declared in the path-level `params` block.
8. **Generate query parsing** — if `query` is declared, use `parseAndValidate(ctx.query, Schema)` for type references, or `parseAndValidate(ctx.query, z.strictObject({...}))` for inline blocks.
9. **Generate body parsing** — for `application/json`, add `bodyParserMiddleware(['json'])` and `parseAndValidate`. For `multipart/form-data`, add `bodyParserMiddleware(['multipart'])` and cast `ctx.body as MultipartBody`.
10. **Generate service call and response** — pass all validated inputs to the service method as positional arguments: each param individually (spread, not as an object), body or multipartBody. Omit any that are not present. Annotate `result` with the TypeScript type derived from the response schema. For `204`, omit `result`, body, and content-type.
11. **Emit the router file** — write the complete TypeScript file with imports, router export, and handlers in DSL order.
12. **Emit registration comment** — append a commented-out registration example at the bottom of the generated file.
13. **Warn on ambiguity** — if a method name cannot be reliably inferred, add `// TODO: verify method name` and inform the user.

---

## Route Handler Patterns

### POST with JSON body

```typescript
// from /path POST (file.op:5)
RouterName.post('/path', bodyParserMiddleware(['json']), async (ctx, next) => {
    const body = await parseAndValidate(ctx.body, InputSchema);

    const service = ctx.container.get(ServiceClass);
    const result: ResponseType = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

### GET collection (with query)

```typescript
// from /path GET (file.op:12)
RouterName.get('/path', async (ctx, next) => {
    const query = await parseAndValidate(ctx.query, Pagination);

    const service = ctx.container.get(ServiceClass);
    const result: ItemType[] = await service.list(query);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

### GET single resource

```typescript
// from /path/:paramId GET (file.op:20)
RouterName.get('/path/:paramId', async (ctx, next) => {
    const { paramId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paramId: z.uuid(),
        }),
    );

    const service = ctx.container.get(ServiceClass);
    const result: ResponseType = await service.getById(paramId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

### PATCH with UUID param and body

```typescript
// from /path/:paramId PATCH (file.op:30)
RouterName.patch('/path/:paramId', bodyParserMiddleware(['json']), async (ctx, next) => {
    const { paramId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paramId: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.body, UpdateSchema);

    const service = ctx.container.get(ServiceClass);
    const result: ResponseType = await service.update(paramId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

### DELETE (204 No Content)

```typescript
// from /path/:paramId DELETE (file.op:42)
RouterName.delete('/path/:paramId', async (ctx, next) => {
    const { paramId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            paramId: z.uuid(),
        }),
    );

    const service = ctx.container.get(ServiceClass);
    await service.delete(paramId);

    ctx.status = 204;

    await next();
});
```

### PUT on junction (two UUID params)

```typescript
// from /path/:parentId/sub/:childId PUT (file.op:50)
RouterName.put('/path/:parentId/sub/:childId', async (ctx, next) => {
    const { parentId, childId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            parentId: z.uuid(),
            childId: z.uuid(),
        }),
    );

    const service = ctx.container.get(ServiceClass);
    const result: ResponseType = await service.replace(parentId, childId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

### POST with multipart/form-data

```typescript
// from /path POST (file.op:58)
RouterName.post('/path', bodyParserMiddleware(['multipart']), async (ctx, next) => {
    const multipartBody = ctx.body as MultipartBody;

    const service = ctx.container.get(ServiceClass);
    const result: string = await service.create(multipartBody);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});
```

---

## Routes Setup Registration

After generating a router file, a registration comment is appended at the bottom of the generated file:

```typescript
// Register in apps/api/src/routes/routes.setup.ts:
// import { {RouterName} } from './{filename}.router';
// server.use({RouterName}.routes()).use({RouterName}.allowedMethods());
```

---

## Operations Full Example

### DSL input (`contracts/operations/ledger.categories.op`)

```
/ledger/categories {
    post: {
        request: {
            application/json: CreateCategoryInput
        }
        response: {
            201: {
                application/json: LedgerCategory
            }
        }
    }
    get: {
        response: {
            200: {
                application/json: array(LedgerCategory)
            }
        }
    }
}

/ledger/categories/:categoryId {
    params: {
        categoryId: uuid
    }
    get: {
        response: {
            200: {
                application/json: LedgerCategory
            }
        }
    }
    patch: {
        request: {
            application/json: UpdateCategoryInput
        }
        response: {
            200: {
                application/json: LedgerCategory
            }
        }
    }
    delete: {
        response: {
            204:
        }
    }
}

/ledger/categories/:categoryId/children/:childId {
    params: {
        categoryId: uuid
        childId: uuid
    }
    put: {
        service: LedgerService.updateCategoryNesting
        response: {
            200: {
                application/json: LedgerCategory
            }
        }
    }
    delete: {
        service: LedgerService.updateCategoryNesting
        response: {
            204:
        }
    }
}
```

### Generated output (`src/routes/ledger.categories.router.ts`)

```typescript
import { z } from 'zod';
import { ServerKitRouter, bodyParserMiddleware } from '@maroonedsoftware/koa';
import { LedgerCategoriesService } from '#modules/ledger-categories/ledger-categories.service.js';
import { LedgerService } from '#modules/ledger/ledger.service.js';
import { CreateCategoryInput, UpdateCategoryInput, LedgerCategory } from '#modules/ledger/types/index.js';
import { parseAndValidate } from '#src/shared/validator.js';

export const LedgerCategoriesRouter = ServerKitRouter();

// from /ledger/categories POST (ledger.categories.op:2)
LedgerCategoriesRouter.post('/ledger/categories', bodyParserMiddleware(['json']), async (ctx, next) => {
    const body = await parseAndValidate(ctx.body, CreateCategoryInput);

    const service = ctx.container.get(LedgerCategoriesService);
    const result: LedgerCategory = await service.create(body);

    ctx.status = 201;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});

// from /ledger/categories GET (ledger.categories.op:11)
LedgerCategoriesRouter.get('/ledger/categories', async (ctx, next) => {
    const service = ctx.container.get(LedgerCategoriesService);
    const result: LedgerCategory[] = await service.list();

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});

// from /ledger/categories/:categoryId GET (ledger.categories.op:24)
LedgerCategoriesRouter.get('/ledger/categories/:categoryId', async (ctx, next) => {
    const { categoryId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            categoryId: z.uuid(),
        }),
    );

    const service = ctx.container.get(LedgerCategoriesService);
    const result: LedgerCategory = await service.getById(categoryId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});

// from /ledger/categories/:categoryId PATCH (ledger.categories.op:32)
LedgerCategoriesRouter.patch('/ledger/categories/:categoryId', bodyParserMiddleware(['json']), async (ctx, next) => {
    const { categoryId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            categoryId: z.uuid(),
        }),
    );

    const body = await parseAndValidate(ctx.body, UpdateCategoryInput);

    const service = ctx.container.get(LedgerCategoriesService);
    const result: LedgerCategory = await service.update(categoryId, body);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});

// from /ledger/categories/:categoryId DELETE (ledger.categories.op:42)
LedgerCategoriesRouter.delete('/ledger/categories/:categoryId', async (ctx, next) => {
    const { categoryId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            categoryId: z.uuid(),
        }),
    );

    const service = ctx.container.get(LedgerCategoriesService);
    await service.delete(categoryId);

    ctx.status = 204;

    await next();
});

// from /ledger/categories/:categoryId/children/:childId PUT (ledger.categories.op:52)
LedgerCategoriesRouter.put('/ledger/categories/:categoryId/children/:childId', async (ctx, next) => {
    const { categoryId, childId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            categoryId: z.uuid(),
            childId: z.uuid(),
        }),
    );

    const service = ctx.container.get(LedgerService);
    const result: LedgerCategory = await service.updateCategoryNesting(categoryId, childId);

    ctx.status = 200;
    ctx.type = 'application/json';
    ctx.body = result;

    await next();
});

// from /ledger/categories/:categoryId/children/:childId DELETE (ledger.categories.op:61)
LedgerCategoriesRouter.delete('/ledger/categories/:categoryId/children/:childId', async (ctx, next) => {
    const { categoryId, childId } = await parseAndValidate(
        ctx.params,
        z.strictObject({
            categoryId: z.uuid(),
            childId: z.uuid(),
        }),
    );

    const service = ctx.container.get(LedgerService);
    await service.updateCategoryNesting(categoryId, childId);

    ctx.status = 204;

    await next();
});


// Register in apps/api/src/routes/routes.setup.ts:
// import { LedgerCategoriesRouter } from './ledger.categories.router';
// server.use(LedgerCategoriesRouter.routes()).use(LedgerCategoriesRouter.allowedMethods());
```

---

# 3. Shared Type Vocabulary

Both skills share the same Zod v4 type vocabulary. When the operations skill references a type emitted by the contracts skill (e.g. `LedgerAccount`, `Pagination`), always import from the module barrel (`#modules/{module}/types/index.js` or `#shared/types/index.js`) — never from individual generated files.

The contracts skill owns **all type definitions**. The operations skill consumes them via imports. This means:

- Running the contracts skill first ensures the type barrel is up to date before generating routers.
- When a `.op` file references a type that doesn't exist yet, flag it with a `// TODO: verify import path` comment and suggest running the contracts skill for the relevant `.dto` file.
