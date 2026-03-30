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

> **Target: Zod v4** — Never use Zod v3 patterns (e.g. `z.number().int()`, `z.string().email()`).

---

## 1. Contracts Skill — `.dto` → Zod Schemas

### DSL Syntax

```
ModelName: {              # Model with fields
    fieldName: type
    optionalField?: type
}
ChildModel: BaseModel {   # Inheritance → .extend()
    extraField: string
}
```

### Type Vocabulary

| DSL type               | Zod v4 output                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `string`               | `z.string()`                                                                                    |
| `number`               | `z.number()`                                                                                    |
| `int`                  | `z.int()` (**not** `z.number().int()`)                                                          |
| `bigint`               | `z.bigint()` (constraints use `n` suffix: `.min(0n)`)                                           |
| `boolean`              | `z.boolean()`                                                                                   |
| `date`/`datetime`      | `z.custom<DateTime>((val) => val instanceof DateTime, { error: 'Must be in ISO 8601 format' })` |
| `email`                | `z.email()` (**not** `z.string().email()`)                                                      |
| `url`                  | `z.url()`                                                                                       |
| `uuid`                 | `z.uuid()`                                                                                      |
| `any`/`unknown`/`null` | `z.any()` / `z.unknown()` / `z.null()`                                                          |
| `object`               | `z.record(z.string(), z.unknown())`                                                             |
| `binary`               | `z.custom<Buffer>((val) => Buffer.isBuffer(val), { error: 'Must be binary data' })`             |
| `literal(value)`       | `z.literal(value)`                                                                              |
| `ModelName`            | Direct reference                                                                                |

### Modifiers (parentheses)

```
string(min=1, max=255)       # length bounds
int(min=0, max=120)          # value bounds
string(len=32)               # exact length → .length(32)
string(regex=/[a-z0-9-]+/)   # regex (anchors ^$ added automatically)
array(type), array(type, min=1, max=10)
tuple(number, number)
record(string, int)
enum(active, inactive)       # → z.enum(["active", "inactive"])
lazy(User)                   # → z.lazy(() => User) for circular deps
```

### Inline objects, unions, optionality, defaults

```
field: { code: string, num: int }      # → z.strictObject({...})
payload: string | number               # → z.union([...])
bio: string | null                     # → .nullable() (NOT z.union with null)
nickname?: string                      # → .optional()
role: string = "user"                  # → .default("user") (replaces .optional())
avatar?: url | null                    # → .nullable().optional()
```

### Read-only / Write-only

Place `readonly`/`writeonly` after `:`, before type:

```
id: readonly uuid          # response only
password: writeonly string  # request only
```

### Comments → descriptions

`# comment` on a field → `.describe("comment")`. On a model line → JSDoc block above `export const`.

### Chaining Order

1. Base type → 2. Constraints (`.min()`, `.max()`, `.length()`, `.regex()`) → 3. `.nullable()` → 4. `.default()` OR `.optional()` (mutually exclusive) → 5. `.describe()`

---

### Output Format

For each model emit:

```typescript
export const {Model} = z.strictObject({ ... });
export type {Model} = z.infer<typeof {Model}>;
```

**Imports:** `import { z } from 'zod';` always. `import { DateTime } from 'luxon';` if date/datetime used.

**Import extensions:** Local imports use `.dto.js`. PascalCase → dot-case (`CounterpartyAccount` → `./counterparty.account.dto.js`).

**Output path:** `contracts/types/modules/{mod}/file.dto` → `src/modules/{mod}/types/file.ts`. `contracts/types/shared/file.dto` → `src/shared/types/file.ts`.

**Dependency order:** Emit models dependencies-first.

### Multi-Schema Pattern (readonly/writeonly)

The number of schemas emitted depends on which modifiers are present (never use `.omit()`):

**No `readonly` or `writeonly` fields → 1 schema:**

- `export const {Model}` — all fields

**Only `readonly` fields → 2 schemas:**

- `export const {Model}` — read/response schema, all fields
- `export const {Model}Input` — write/request schema, excludes `readonly` fields

**Only `writeonly` fields → 2 schemas:**

- `export const {Model}` — read/response schema, excludes `writeonly` fields
- `export const {Model}Input` — write/request schema, all fields

**Both `readonly` and `writeonly` fields → 3 schemas:**

- `const {Model}Base` — unexported, all fields
- `export const {Model}` — read/response schema, excludes `writeonly` fields
- `export const {Model}Input` — write/request schema, excludes `readonly` fields

For inheritance with multi-schema, extend from `{Base}Base` (3-schema) or the appropriate parent schema (2-schema).

### FromDb Schema Pattern

Every model also gets `export const {Model}FromDb` — parses raw DB rows. Rules:

- **No constraints** (no `.min()`, `.max()`, `.length()`, `.regex()`, `.default()`, `.describe()`)
- **All fields** regardless of readonly/writeonly
- Preserves `.optional()` and `.nullable()`
- Comment format: `// fromDb ModelName (filename.dto:line)`

**FromDb type mappings that differ from main schema:**

| DSL type              | FromDb Zod                                             |
| --------------------- | ------------------------------------------------------ |
| `int`                 | `z.number()`                                           |
| `bigint`              | `z.string().transform((s) => BigInt(s))`               |
| `date`/`datetime`     | `z.custom<DateTime>((val) => val instanceof DateTime)` |
| `email`/`url`/`uuid`  | `z.string()`                                           |
| `string(constraints)` | `z.string()` (no constraints)                          |
| `ModelRef`            | `ModelRefFromDb`                                       |

FromDb chaining: base → `.transform()` → `.nullable()` → `.optional()`

---

## 2. Operations Skill — `.op` → Koa Route Handlers

### DSL Syntax

```
/path/to/resource {
    params: { paramId: uuid }          # path-level, shared by all methods
    post: {
        headers: { x-request-id: uuid }
        request: { application/json: CreateInput }
        response: { 201: { application/json: OutputType } }
    }
    get: {
        query: PaginationQuery
        response: { 200: { application/json: array(OutputType) } }
    }
    delete: {
        response: { 204: }
    }
}
```

**Method blocks:** `get`, `post`, `put`, `patch`, `delete`

**Properties:** `service` (override), `headers`, `query`, `request`, `response`, `params` (path-level)

### Service Override

`service: LedgerService.getAccountBalances` — overrides both class and method.

### Convention-Based Inference

**Service class** from filename: PascalCase dot-segments + `Service`

- `ledger.categories.op` → `LedgerCategoriesService`
- Import: `#modules/{kebab-case}/{kebab-case}.service.js`

**Method name** from HTTP verb:

| Verb   | Has `:param` | Method    |
| ------ | ------------ | --------- |
| GET    | No           | `list`    |
| GET    | Yes          | `getById` |
| POST   | —            | `create`  |
| PUT    | —            | `replace` |
| PATCH  | —            | `update`  |
| DELETE | —            | `delete`  |

### Output Format

**File path:** `contracts/operations/{name}.op` → `src/routes/{name}.router.ts`
**Router name:** PascalCase dot-segments + `Router`

### Imports (order)

1. Third-party (`zod`, `luxon`)
2. Framework (`@maroonedsoftware/koa` — `ServerKitRouter`, `bodyParserMiddleware`)
3. Marooned packages (`@maroonedsoftware/multipart` — `MultipartBody`)
4. Services (`#modules/...`)
5. Types (`#modules/.../types/index.js` or `#shared/types/index.js`)
6. Utilities (`#src/shared/validator.js` — `parseAndValidate`)

Only include imports that are actually used. All local imports use `.js` extensions.

### Code Generation Patterns

**Params:** `parseAndValidate(ctx.params, z.strictObject({...}))` — destructure result.
**Headers:** `parseAndValidate(ctx.headers, z.object({...}).passthrough())` — note: `z.object` not `z.strictObject`.
**Query:** `parseAndValidate(ctx.query, Schema)` for refs, inline `z.strictObject` for blocks.
**JSON body:** Add `bodyParserMiddleware(['json'])` as middleware, then `parseAndValidate(ctx.body, Schema)`.
**Multipart:** Add `bodyParserMiddleware(['multipart'])`, then `ctx.body as MultipartBody`.
**Service call:** `ctx.container.get(ServiceClass)` → call method with params spread individually then body.
**Response 200/201:** `const result: Type = await service.method(...); ctx.status = N; ctx.type = 'application/json'; ctx.body = result;`
**Response 204:** No result/body/type. Just `ctx.status = 204;`.
**Response type annotation:** `array(T)` → `T[]`, model → `Model`, scalar → `string`/`number`.
**All handlers:** End with `await next();`.

**Router registration:** After generating the router file, read `apps/api/src/routes/routes.setup.ts` and check whether the router is already imported and registered. If not, append the import and registration lines:

```typescript
import { {Router} } from './{filename}.router.js';
server.use({Router}.routes()).use({Router}.allowedMethods());
```

Place the import with the other router imports and the `server.use` call with the other registrations, maintaining alphabetical order.

### Handler Template

```typescript
RouterName.patch('/path/:id', bodyParserMiddleware(['json']), async (ctx, next) => {
  const { id } = await parseAndValidate(ctx.params, z.strictObject({ id: z.uuid() }));
  const body = await parseAndValidate(ctx.body, UpdateSchema);

  const service = ctx.container.get(ServiceClass);
  const result: ResponseType = await service.update(id, body);

  ctx.status = 200;
  ctx.type = 'application/json';
  ctx.body = result;

  await next();
});
```

---

## 3. Shared Notes

- Both skills share the same Zod v4 type vocabulary
- Contracts skill owns **all type definitions**; operations skill imports from module barrels (`#modules/{module}/types/index.js`)
- Run contracts first to ensure type barrel is up to date
- When `.op` references an undefined type, add `// TODO: verify import path`
- Unrecognized types → `z.unknown()` with `// TODO` comment
