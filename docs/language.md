# ContractKit language reference

Contract files use the `.ck` extension. A file can contain an optional `options` block followed by any number of `contract` and `operation` declarations in any order.

## File Structure

```
options { keys: { area: billing } }   # optional — file metadata

contract Foo: { id: uuid }            # type declarations
contract Bar: Foo & { name: string }

operation /path: {                    # route declarations
    get: {}
}
```

---

## Options Block

Declares file-level metadata: key/value pairs, service import paths, security defaults, and global request/response headers.

```
options {
    keys: {
        area: ledger
    }
    services: {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
    request: {
        headers: {
            authorization: string
            x-request-id?: uuid
        }
    }
    response: {
        headers: {
            x-request-id: uuid
        }
    }
    security: {
        policy: paymentsWrite
    }
}
```

- **`keys`** — arbitrary key/value pairs attached to the file's metadata (e.g. `area` is used for grouping in generated docs). Any key can also be referenced from any string in the file as `{{name}}`; see [Variable substitution](#variable-substitution).
- **`services`** — maps service identifiers to import paths; used in `service:` bindings within operations. Paths starting with `#` are resolved as package-relative imports.
- **`request: { headers }`** — request headers applied to every operation in the file. Op-level headers with the same name override; an operation can opt out entirely with `headers: none`. A name collision with a path parameter raises an error.
- **`response: { headers }`** — response headers applied to every status code on every operation. Per-status override is `headers: { same-name: <type> }`; per-status opt-out is `headers: none`. Note: OpenAPI and Markdown reflect these on every status, while the TS server and the SDKs only emit them for statuses the service actually produces or a client can receive — a header on a documentation-only status has nowhere to be written at runtime.
- **`security`** — file-level default security applied to all operations unless overridden at the route or operation level. Accepts the same syntax as operation-level `security:` blocks.

### Variable substitution

Any string in a `.ck` file can reference a value from `options.keys` with `{{name}}`:

```
options {
    keys: { bruno: "../../bruno" }
}

operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/authentication/request.token.yml" }
        response: { 201: { application/json: AuthenticationToken } }
    }
}
```

Behavior:

- `{{name}}` resolves to `options.keys[name]` first, then to a workspace-wide fallback collected by the CLI from each plugin's `keys` config in `contractkit.config.json`. If neither layer defines the name, the literal string `undefined` is emitted and a warning is raised.
- `\{{name}}` escapes the substitution; the literal characters `{{name}}` are emitted with no warning.
- Substitution applies to every string field in the AST except `options.keys` itself — keys are not recursively expanded.

---

## Contract Declarations

`contract` declares a named type that compiles to a Zod schema and a TypeScript type.

### Basic Model

```
contract User: {
    id: readonly uuid
    name: string
    email: email
    age?: int
    role: enum(admin, member) = member
    active: boolean = true
}
```

### Inheritance

Use `&` to extend one or more base models. The generated Zod schema uses chained `.extend()`s, OpenAPI emits `allOf`, plain TypeScript emits `extends` (with `Omit<...>` per base when fields are overridden), and Python emits a comma-separated parent list.

```
contract Admin: User & {
    permissions: array(string)
    department: string
}
```

**Multi-base** — list bases left-to-right, inline block last:

```
contract Test5: Test1 & Test2 & Test3 & Test4 & {
    e: string
}
```

When two or more bases declare a field with the **same name and same shape**, no action is needed — the duplicate is silently deduplicated.

When two or more bases declare a field with the **same name but different shape** (different type, optionality, nullability, visibility, default, or deprecation), this is a **conflict**. The model must redeclare that field in its inline block with the `override` modifier; otherwise compilation fails:

```
contract A: { x: string }
contract B: { x: int }

contract C: A & B & {
    x: override int     # required — bases disagree
}
```

`override` also acts as a deliberate redeclaration when extending a single base — it makes shadowing intent explicit. It must shadow at least one base-contributed field; using `override` on a name that no base declares is an error.

The override declaration **fully replaces** the field — visibility, optionality, defaults, and deprecation flags from the base are not inherited. Re-add them on the override line if needed:

```
override x: readonly int = 0
```

### Type Alias

A contract that maps directly to a type expression — no braces, no fields.

```
contract UserId: uuid
contract Status: enum(active, inactive, pending)
contract Tags: array(string)
contract MaybeUser: User | null
```

A trailing `#` comment on a type alias becomes the schema's `.describe()` string:

```
contract OfferStatus: enum(active, accepted, declined, expired) # The status of the offer
```

---

## Contract Modifiers

Modifiers appear between the `contract` keyword and the model name, in any order.

### `deprecated`

Marks the entire type as deprecated.

```
contract deprecated LegacyUser: {
    id: uuid
    username: string
}
```

Effect:

- Emits `/** @deprecated */` JSDoc on the generated schema and TypeScript type
- Sets `deprecated: true` in the OpenAPI schema object
- Adds a deprecation notice in generated markdown docs

### `mode(strict|strip|loose)`

Controls how Zod handles unknown keys on the object schema. Default is `strict`.

```
contract mode(strip) UserInput: {
    name: string
    email: email
}
```

| Mode     | Zod Method       | Behavior                       |
| -------- | ---------------- | ------------------------------ |
| `strict` | `z.strictObject` | Rejects unknown keys (default) |
| `strip`  | `z.object`       | Silently removes unknown keys  |
| `loose`  | `z.looseObject`  | Passes unknown keys through    |

### `format(input=camel|snake|pascal)` and `format(output=camel|snake|pascal)`

Applies a key-casing transform when parsing input and/or serializing output. Useful for external data sources that use a different naming convention than the application's internal camelCase convention.

```
contract format(input=camel) mode(loose) WebhookPayload: {
    eventType: string
    createdAt: datetime
    organizationId: uuid
}
```

With `format(input=camel)`, the schema accepts camelCase keys (e.g. `eventType`) and transforms them to the internal camelCase representation. Use `format(input=snake)` to accept `snake_case` keys, or `format(input=pascal)` to accept `PascalCase` keys.

`format(output=snake)` transforms the output keys from internal camelCase to `snake_case` before serialization. Both args can be combined:

```
contract format(input=pascal, output=snake) ExternalEvent: {
    eventType: string
    createdAt: datetime
}
```

This accepts `PascalCase` input keys and emits `snake_case` output keys.

Multiple modifiers may appear in any order:

```
contract deprecated format(input=camel) mode(strip) OldWebhookPayload: {
    eventType: string
}
```

---

## Scalar Types

| Type       | Zod Output                | Notes                                                                           |
| ---------- | ------------------------- | ------------------------------------------------------------------------------- |
| `string`   | `z.string()`              |                                                                                 |
| `number`   | `z.coerce.number()`       |                                                                                 |
| `int`      | `z.coerce.number().int()` |                                                                                 |
| `bigint`   | `z.coerce.bigint()`       |                                                                                 |
| `boolean`  | `z.coerce.boolean()`      |                                                                                 |
| `date`     | `z.string().date()`       | ISO 8601 date string                                                            |
| `time`     | `z.string().time()`       | ISO 8601 time string                                                            |
| `datetime` | Luxon `DateTime`          | Full ISO 8601 datetime                                                          |
| `interval` | Luxon `Interval`          | ISO 8601 interval (e.g. `2024-01-01/2024-12-31`); serialized back to ISO string |
| `email`    | `z.string().email()`      |                                                                                 |
| `url`      | `z.string().url()`        |                                                                                 |
| `uuid`     | `z.string().uuid()`       |                                                                                 |
| `unknown`  | `z.unknown()`             |                                                                                 |
| `null`     | `z.null()`                | Typically used in union: `T \| null`                                            |
| `object`   | `z.object({})`            | Untyped/passthrough object                                                      |
| `binary`   | `z.custom<Buffer>(...)`   | Node.js Buffer validation                                                       |
| `json`     | Recursive `_ZodJson`      | Any JSON-serializable value                                                     |

---

## Compound Types

Compound types take arguments in parentheses. Arguments may be type expressions, key=value constraint pairs, or literals.

| Syntax                             | Zod Output                             |
| ---------------------------------- | -------------------------------------- |
| `array(T)`                         | `z.array(T)`                           |
| `array(T, min=1, max=10)`          | `z.array(T).min(1).max(10)`            |
| `tuple(A, B, C)`                   | `z.tuple([A, B, C])`                   |
| `record(K, V)`                     | `z.record(K, V)`                       |
| `enum(a, b, c)`                    | `z.enum(["a", "b", "c"])`              |
| `literal("val")`                   | `z.literal("val")`                     |
| `literal(42)`                      | `z.literal(42)`                        |
| `literal(true)`                    | `z.literal(true)`                      |
| `lazy(T)`                          | `z.lazy(() => T)`                      |
| `discriminated(by=k, A \| B \| C)` | `z.discriminatedUnion("k", [A, B, C])` |

---

## Type Constraints

Scalar types accept constraint arguments in parentheses:

```
contract Validated: {
    slug: string(min=1, max=50, regex=/^[a-z0-9-]+$/)
    code: string(length=3)
    score: number(min=0, max=100)
    count: int(min=1)
    tags: array(string, min=1, max=20)
}
```

| Constraint        | Applies To            | Description                     |
| ----------------- | --------------------- | ------------------------------- |
| `min=N`           | string, number, array | Minimum length / value / count  |
| `max=N`           | string, number, array | Maximum length / value / count  |
| `length=N`        | string                | Exact string length             |
| `regex=/pattern/` | string                | Regex pattern validation. Patterns without `^`/`$` are auto-anchored for full-match semantics; patterns with explicit anchors are emitted as-written. |
| `format=name`     | string                | Named format hint (passthrough) |

---

## Union and Intersection Types

Types can be composed with `|` (union) and `&` (intersection):

```
contract Response: {
    data: User | Team | null
    meta: Pagination & { total: int }
}
```

- `A | B` compiles to `z.union([A, B])`
- `A & B` compiles to `A.and(B)` — or `.extend()` when one side is an inline object and the other is a model reference

A leading `|` is permitted so multi-line unions read cleanly:

```
contract AuthenticationRequest:
    | ClientCredentialsAuthenticationRequest
    | PasswordAuthenticationRequest
    | RefreshTokenAuthenticationRequest
    | LinkAuthenticationRequest
    | OtpAuthenticationRequest
    | FidoAuthenticationRequest
```

---

## Discriminated Unions

When every member of a union carries a shared literal field, wrap it in
`discriminated(by=<field>, ...)` to emit a faster, narrower runtime check
and a richer OpenAPI schema:

```
contract CardPayment: { kind: literal("card"), last4: string(len=4) }
contract BankPayment: { kind: literal("bank"), accountId: string }
contract WirePayment: { kind: literal("wire"), swift: string }

contract PaymentMethod:
    discriminated(by=kind, CardPayment | BankPayment | WirePayment)
```

What you get:

| Output           | Result                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| **Zod**          | `z.discriminatedUnion("kind", [CardPayment, BankPayment, WirePayment])` |
| **TypeScript**   | `CardPayment \| BankPayment \| WirePayment` (TS narrows on `kind`)      |
| **OpenAPI**      | `oneOf` with a `discriminator: { propertyName, mapping }` block         |
| **Python (SDK)** | `Annotated[Union[...], Field(discriminator="kind")]` (Pydantic v2)      |

The compiler validates discriminated unions at parse time:

- Every member must be a model reference or inline object
- Every member must contain a field matching the discriminator name
- That field must be a `literal(...)` or `enum(...)` type
- At least two members are required

Failing any check produces a warning that points to the offending member.

---

## Field Syntax

Fields follow the pattern:

```
name?: [modifiers] TypeExpression [= defaultValue]  # optional comment
```

### Optionality

`?` after the field name marks it optional:

```
nickname?: string
```

Compiles to `.optional()` on the field's schema.

### Nullability

Include `null` in a union to allow null values:

```
middleName: string | null
deletedAt: datetime | null
```

Compiles to `.nullable()` on the field's schema.

### Field Modifiers

Modifiers appear after `:` and before the type expression, in any order.

**`readonly`** — present only in the read schema (excluded from write/input). Use for server-generated values:

```
id: readonly uuid
createdAt: readonly datetime
```

**`writeonly`** — present only in the write/input schema (excluded from read). Use for secrets:

```
password: writeonly string
```

**`deprecated`** — marks the field as deprecated. Can be combined with `readonly`/`writeonly` in either order:

```
legacyId: deprecated string
token: deprecated writeonly string
apiKey: writeonly deprecated string   # order doesn't matter
```

Effect: emits `/** @deprecated */` in generated TypeScript, sets `deprecated: true` in OpenAPI property schema.

When a model contains `readonly` or `writeonly` fields, the compiler generates three schemas:

- `ModelBase` — all fields (internal, used for `.extend()`)
- `Model` — read schema (omits `writeonly` fields)
- `ModelInput` — write schema (omits `readonly` fields)

### Default Values

```
status: enum(active, inactive) = active
retries: int = 3
label: string = "untitled"
enabled: boolean = true
```

Compiles to `.default(value)` on the schema.

### Inline Object Types

Fields can declare anonymous nested objects inline. Mode modifiers are supported:

```
contract Order: {
    id: uuid
    address: {
        street: string
        city: string
        zip: string(length=5)
    }
    metadata: mode(strip) {
        source: string
        campaign?: string
    }
}
```

Inline objects also support intersection with a model reference:

```
query: Pagination & {
    status?: array(Status)
    from?: date
}
```

---

## Descriptions and Comments

`#` starts a line comment. Comments are contextually attached to the node they precede or follow inline.

```
# Represents an authenticated user
contract User: {
    id: readonly uuid     # server-assigned identifier
    name: string          # full display name
    email: email
}
```

- A `#` comment on the line **before** a `contract` becomes the model's `.describe()` string and appears in generated docs
- A `#` comment on a **type alias** line becomes its description: `contract Status: enum(a, b) # desc`
- A `#` comment **inline on a field** (same line) becomes the field's `.describe()` string
- A `#` comment on the line **before** a field becomes that field's description
- A `#` comment separated from the declaration below it by a **blank line** is standalone — a
  section divider rather than a description, and is not attached to any node
- A `#` comment may sit directly inside an `options { ... }` block, between its sub-blocks
- A `#` comment may sit **above** the `options` keyword, as a file header
- A `#` comment may trail a `keys`/`services` entry, provided a space separates it from the
  value. A `#` with no space before it belongs to the value, so an unquoted subpath import
  (`PetService: #modules/pet/pet.service.js`) still parses as one; quote a value that needs a
  space followed by `#` inside it

```
options {
    # resolved from the deploy environment
    keys: { area: payments }
}

# ─── Pet endpoints ───

# An order placed for purchasing a pet
contract Order: {
    id: readonly int
}
```

---

## Operation Declarations

`operation` declares a route with one or more HTTP method handlers. Compiles to a Koa router.

### Basic Structure

```
operation /path: {
    get: {}
    post: {}
    put: {}
    patch: {}
    delete: {}
}
```

### Route Modifiers

Modifiers use function-call syntax on the `operation` keyword:

```
operation(internal) /admin/users: { get: {} }
operation(deprecated) /v1/users: { get: {} }
```

| Modifier     | Effect                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `internal`   | By default: excluded from SDK / Python SDK / OpenAPI / Markdown output, included in the server router and Bruno collection. Each plugin accepts an `includeInternal: boolean` config option to override its default. |
| `deprecated` | Adds `@deprecated` JSDoc and `deprecated: true` in OpenAPI output for all operations on this route.     |

Route-level modifiers cascade to all operations. Individual operations can override using the same modifier syntax on the HTTP method verb (see below).

---

## Path Parameters

Declare path parameters with `{paramName}` in the route path:

```
operation /users/{id}: {
    params: {
        id: uuid
    }
    get: {}
}
```

Multiple parameters:

```
operation /orgs/{orgId}/members/{memberId}: {
    params: {
        orgId: uuid
        memberId: uuid # the member to fetch
    }
    get: {}
}
```

The `params` block can also reference a named contract type:

```
operation /users/{id}: {
    params: UserParams
    get: {}
}
```

An `objectMode` modifier can be applied to the params block:

```
params: mode(strip) {
    id: uuid
}
```

Path parameter types accept the full type-expression syntax — including constraints, enums, and unions:

```
operation /orders/{orderId}: {
    params: {
        orderId: int(min=1, max=5)
    }
    get: {}
}

operation /pets/{status}: {
    params: {
        status: enum(available, pending, sold)
    }
    get: {}
}
```

The compiler validates that every `{param}` in the path has a corresponding entry in the `params` block and warns on mismatches. Path parameters are compiled to Koa `:param` syntax in the generated router.

---

## HTTP Method Blocks

Each HTTP verb opens a block with its operation details. An inline `#` comment after `{` becomes the operation's description:

```
get: { # list all active users
    service: UserService.list
    ...
}
```

A `#` comment on the line **before** a verb also becomes its description:

```
# Create a new user
post: {
    service: UserService.create
    ...
}
```

### Operation Modifiers

Apply a modifier to a specific verb:

```
operation(internal) /admin/users: {
    get(public): {   # overrides route-level internal — this one IS in the SDK
        response: { 200: { application/json: array(User) } }
    }
    post: {}         # still internal
    delete(deprecated): {}  # internal AND deprecated
}
```

| Modifier     | Scope          | Effect                                                                              |
| ------------ | -------------- | ----------------------------------------------------------------------------------- |
| `internal`   | operation      | Overrides a route-level `public` or no modifier to make this operation internal.    |
| `deprecated` | operation      | Marks this operation deprecated in OpenAPI and JSDoc.                               |
| `public`     | operation only | Overrides a route-level `internal` modifier to make this specific operation public. |

---

## Query Parameters

Declare query parameters inline or by reference:

```
get: {
    query: {
        page?: int
        limit?: int = 20
        search?: string
    }
}
```

Reference a named type:

```
get: {
    query: PaginationQuery
}
```

Intersection with inline additions:

```
get: {
    query: Pagination & {
        status?: array(Status)
        from?: date
        to?: date
    }
}
```

Apply an object mode to control unknown key handling:

```
get: {
    query: mode(strip) {
        page?: int
    }
}
```

---

## Request Headers

```
post: {
    headers: {
        authorization: string
        x-request-id?: uuid
        x-idempotency-key?: string
    }
}
```

Or by type reference, with optional mode:

```
post: {
    headers: mode(strip) WebhookHeaders
}
```

---

## Request Body

```
post: {
    request: {
        application/json: CreateUserInput
    }
}
```

Supported content types: `application/json`, `multipart/form-data`.

Inline body types are supported:

```
post: {
    request: {
        application/json: {
            name: string
            email: email
        }
    }
}
```

---

## Response

```
get: {
    response: {
        200: {
            application/json: User
        }
    }
}
```

Multiple status codes:

```
post: {
    response: {
        201: {
            application/json: User
        }
        422: {
            application/json: ValidationError
        }
    }
}
```

No-body response (status only):

```
delete: {
    response: {
        204:
    }
}
```

### Several content types for one status

A status may declare more than one mime. The service picks which it produced, and the router
sets `ctx.type` from that choice rather than from a fixed literal.

```
get: {
    response: {
        200: {
            image/png: binary
            image/jpeg: binary
        }
    }
}
```

The service returns `{ contentType: 'image/png' | 'image/jpeg'; body: Buffer }`, and the SDK
reports which mime came back alongside the data. When the declared bodies have different types,
`contentType` and `body` stay correlated as a union of members.

### Which statuses the service produces

A status is **emitted** — returned by the service and written by the router — if it has a block,
or is 2xx. Everything else is **documented**: it appears in OpenAPI, the SDKs and the docs, but
something other than the service produces it (middleware, a framework short-circuit, or the
thrown-error path).

| Declaration | Default | Why |
| --- | --- | --- |
| any status with a block — `200: { … }`, `422: { application/json: Problem }` | emitted | the block describes what the service produces |
| 2xx bare — `204:` | emitted | a real outcome the handler chooses |
| 3xx/4xx/5xx bare — `304:`, `400:`, `404:` | documented | middleware or the error path produces it |

Two ways to override the default:

```
304: {}                                  # empty block: the service returns this, with no body
404(documented): { application/json: Problem }   # declared shape, but thrown rather than returned
```

An error status carrying a body is emitted like any other, so the handler returns the problem
document instead of throwing:

```
get: {
    response: {
        200: { application/json: Pet }
        422: { application/json: Problem }
        404:
    }
}
```

The service returns `{ status: 200; … } | { status: 422; … }` and the router switches on
`result.status`. Marking the 422 `(documented)` puts it back on the throw path and restores the
single-status shape. `(documented)` on a bare bodyless 3xx/4xx/5xx changes nothing and warns.

Client-side, the SDK's return type covers every status a caller can *receive* as a value: every
emitted status, plus non-emitted ones below 400 such as a `304` produced by conditional-GET
middleware. Those are passed to the shared fetch as `expectStatuses` so they no longer surface as
`SdkError`. What remains — non-emitted 4xx/5xx — is the throw path, typed via a per-operation
`…ErrorBody` alias referenced from the method's `@throws` tag.

### Typed response headers

Each status code can declare typed response headers alongside the body. Names use the on-the-wire form (hyphens allowed, case-insensitive). The `?` suffix marks a header optional.

```
get: {
    response: {
        200: {
            application/json: Transfer
            headers: {
                preference-applied?: string
                vary?: string
                etag: string # cache validator
            }
        }
    }
}
```

Generated effects:

- **OpenAPI** emits `headers:` under each response with the schema and required flag.
- **TypeScript SDK** changes the method's return shape from `Promise<T>` to `Promise<{ data: T; headers: { preferenceApplied?: string; ... } }>` (or `Promise<{ headers: ... }>` for void responses). Header names are camelCased; values are read from the `Headers` object as strings (`null` becomes `undefined`).
- **TypeScript router** types the service method's return as `{ body, headers }` (or `{ headers }` for void), and the wrapper calls `ctx.set(name, String(value))` for each declared header.
- **Python SDK** generates a per-method `TypedDict` (e.g. `GetTransferHeaders`) and changes the return type to `tuple[T, GetTransferHeaders]` (or `GetTransferHeaders` for void). Header keys are snake_cased; values come from the lower-cased response-header dict.
- **Bruno** adds an `isDefined` runtime assertion for each required response header on the asserted status code, and lists all declared headers in the request's `docs` block.
- **Markdown docs** render a `Response headers` table per status code.

Operations without a `headers` block on their response keep the current return shape — this change is opt-in per response.

---

## Security

Security can be declared at the file level (inside the `options` block), at the route level, or at the operation level. It cascades from operation → route → file → config default.

**Explicitly public** (no auth required):

```
post: {
    security: none
    ...
}
```

**Require a named policy** (e.g. for step-up auth or scope enforcement):

```
get: {
    security: {
        policy: paymentsWrite
    }
    ...
}
```

Use `policy: none` to explicitly bypass policy enforcement on an otherwise-authenticated route. Route-level security applies to all operations in the route unless overridden:

```
operation /admin/users: {
    security: {
        policy: adminWrite
    }

    get: {}      # requires the adminWrite policy
    post: {}     # requires the adminWrite policy

    delete: {
        security: none   # overridden — public
    }
}
```

---

## Service Binding

Binds the operation to a service method. The service name must be declared in the `options` block.

```
post: {
    service: UserService.create
    ...
}
```

The generated router imports and calls `UserService.create(ctx)`.

---

## SDK Method Name

By default the SDK method name is derived from the route path and HTTP verb. To override it explicitly:

```
get: {
    sdk: getById
    service: UserService.getById
    ...
}
```

---

## MCP Exposure

Mark an individual HTTP verb as MCP-exposed so an MCP plugin can generate a tool/route for it. The `mcp` field is per-verb (each verb maps to one MCP tool) and defaults to `false` — an absent `mcp` or `mcp: false` means "not exposed."

The simplest form is a boolean, which derives all tool metadata from the operation:

```
get: {
    name: Get Route
    mcp: true
    service: RoutesService.getRoute
    response: {
        200: { application/json: Application }
    }
}
```

For explicit MCP tool metadata, use the settings block:

```
post: {
    service: RoutesService.search
    mcp: {
        name: "searchRoutes"
        title: "Search routes"
        description: "Full-text search across routes; returns matches."
        hint: readOnly, idempotent, nonDestructive
    }
    request:  { application/json: RouteQuery }
    response: { 200: { application/json: RouteList } }
}
```

Settings:

| Key | Value | Meaning |
| --- | --- | --- |
| `name` | quoted string | Tool id override (else derived from `sdk` → `name` → HTTP method + path) |
| `title` | quoted string | Human display title |
| `description` | quoted string | LLM-facing tool description (distinct from the `#` doc comment) |
| `hint` | comma-separated tokens | MCP tool annotation hints |

`hint` is a bracket-less comma-separated token list (like `enum(...)` args without the parens). Each token sets one MCP annotation; positive/negative pairs let you turn a hint on or off (two of the four default to `true` in MCP):

| Token | Sets | Token | Sets |
| --- | --- | --- | --- |
| `readOnly` | `readOnlyHint = true` | `nonReadOnly` | `readOnlyHint = false` |
| `idempotent` | `idempotentHint = true` | `nonIdempotent` | `idempotentHint = false` |
| `destructive` | `destructiveHint = true` | `nonDestructive` | `destructiveHint = false` |
| `openWorld` | `openWorldHint = true` | `closedWorld` | `openWorldHint = false` |

Unknown keys, unknown or conflicting hint tokens (e.g. both `readOnly` and `nonReadOnly`), and duplicates are compile-time errors.

### Generating an MCP server (TypeScript plugin)

The `@contractkit/plugin-typescript` plugin turns `mcp`-flagged operations into a
[`@maroonedsoftware/mcp`](https://github.com/MaroonedSoftware/ServerKit/tree/main/packages/mcp) server
via an `mcp` sub-config:

```json
"@contractkit/plugin-typescript": {
    "mcp": {
        "baseDir": "apps/api/",
        "output": { "tools": "src/mcp/{filename}.mcp.ts" },
        "servicePathTemplate": "#modules/{kebab}/{kebab}.service.js"
    }
}
```

For each `.ck` file with at least one flagged op it emits `<filename>.mcp.ts` — one `@Injectable()`
tool-handler class per operation (mirroring the Koa router split) — plus a `mcp.tools.ts` aggregator
exporting `registerMcpTools(container)` (which assembles the DI `McpToolHandlerMap`) and, unless
`emitRouter: false`, a `mcp.router.ts` with the `POST /mcp` route. Each tool handler:

- derives its tool name from `mcp.name` → `sdk` → `name` → the HTTP method + path (the last three
  snake-cased), and its class name from that with an `McpTool` suffix;
- advertises `inputSchema`/`outputSchema` (JSON Schema) generated from the operation's Zod schemas via
  `z.toJSONSchema()`, and validates incoming args against the same schema;
- constructor-injects the operation's `service` and calls it in-process, returning the result as MCP
  tool content.

Tools require the model **Zod schemas** to be generated (via the `server` sub-config with `zod: true`,
or the `zod` sub-config); set `mcp.output.types` to point at them explicitly if neither is configured.
`internal` operations are excluded unless `includeInternal: true`. The generated code depends on
`@maroonedsoftware/mcp`, `@modelcontextprotocol/sdk`, `injectkit`, and `zod`; the runtime owns the
JSON-RPC lifecycle, session management, Streamable HTTP transport, and auth.

---

## Webhook Signature

For HMAC-authenticated webhooks, bind the operation to a signature key:

```
post: {
    signature: MODERN_TREASURY_WEBHOOK
    security: none
    headers: WebhookHeaders
    request: {
        application/json: unknown
    }
    response: {
        204:
    }
}
```

The `signature` value must match an HMAC scheme name in the config. The generated router middleware validates the HMAC signature before the handler runs.

To attach a signature-scoped policy, use the block form. `options:` carries the HMAC scheme name (same value as the bare form), and `policy:` names a policy that gates the signature check:

```
post: {
    signature: {
        options: SLACK_WEBHOOK
        policy: slackSignatureValid
    }
    security: none
    response: {
        204:
    }
}
```

Both forms are interchangeable — the bare `signature: KEY` is shorthand for a block with only `options:`. The block's `policy:` is distinct from `security: { policy: }`; it is passed through to the generated `requireSignature('SLACK_WEBHOOK', { policy: 'slackSignatureValid' })` middleware.

---

## Per-Operation Plugin Extensions

An operation can attach plugin-specific configuration via the `plugins:` block. Each entry maps a plugin name to a JSON-like value (string, number, boolean, null, object, array) — the plugin owns its schema for that value:

```
post: {
    plugins: {
        bruno: {
            template: "file://request-token.yml"
        }
    }
    request: {
        application/json: AuthRequest
    }
    response: {
        200: { application/json: AuthResponse }
    }
}
```

Any string starting with `file://` is treated as a path relative to the `.ck` file, and any string starting with `http://` or `https://` is fetched via GET; in both cases the CLI replaces the URL with the response body before plugins run. The original (raw) tree lives at `op.plugins`; the resolved tree lives at `op.pluginExtensions`. Missing files, network errors, and non-2xx responses emit a warning and leave the URL string in place.

When the build cache is enabled, successful HTTP responses are persisted under `<rootDir>/.contractkit/cache/http/` (keyed by URL hash) and reused on subsequent runs without hitting the network. The build hash cache lives next to it at `<rootDir>/.contractkit/cache/build.json`. Add `.contractkit/` to `.gitignore`. Pass `--force` (or set `cache: false`) to bypass both caches. Each unique URL is also deduplicated within a single run.

Plugins can validate their entry shape at compile time by implementing `validateExtension(value)` on the `ContractKitPlugin` interface and returning `{ errors?: string[]; warnings?: string[] }`. The CLI matches each entry's key against each plugin's `name` and runs the validator post-resolution. The Bruno plugin uses this to enforce a `{ template?: string }` shape and reject unknown fields.

This is the escape hatch for cases where a plugin's generated output needs to be replaced or augmented with hand-authored content (for example, a Bruno request that needs a post-response script to extract an auth token).

---
