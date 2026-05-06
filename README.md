# ContractKit

A domain-specific language for defining API contracts. Compiles `.ck` (contractkit) files into TypeScript code with Zod schemas and Koa routers.

## Quick Start

```bash
pnpm install
pnpm test
```

### CLI Usage

```bash
contractkit [options]

Options:
  -c, --config <path>  Path to config file (default: searches for contractkit.config.json)
  -w, --watch          Watch for changes and recompile
      --force          Skip incremental cache, recompile all
```

The compiler searches upward from the current directory for `contractkit.config.json`.

## Configuration File

Create `contractkit.config.json` in your project root. The CLI itself only handles file discovery, caching, and prettier formatting — all code generation happens in **plugins** declared under `"plugins"`.

```json
{
    "rootDir": ".",
    "cache": true,
    "prettier": true,
    "patterns": ["contracts/types/**/*.ck", "contracts/operations/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-typescript": {
            "server": {
                "baseDir": "apps/api/",
                "zod": true,
                "output": {
                    "routes": "src/routes/{filename}.router.ts",
                    "types": "src/modules/{area}/types/{filename}.ts"
                },
                "servicePathTemplate": "#modules/{module}/{module}.service.js"
            },
            "sdk": {
                "baseDir": "packages/sdk/",
                "name": "myapp",
                "output": {
                    "sdk": "src/{name}.sdk.ts",
                    "types": "src/{area}/types/{filename}.ts",
                    "clients": "src/{area}/{filename}.client.ts"
                }
            }
        },
        "@contractkit/plugin-openapi": {
            "baseDir": "docs/api/",
            "output": "openapi.yaml",
            "info": { "title": "My API", "version": "1.0.0" },
            "servers": [{ "url": "https://api.example.com" }],
            "security": [{ "bearerAuth": [] }],
            "securitySchemes": {
                "bearerAuth": { "type": "http", "scheme": "bearer", "bearerFormat": "JWT" }
            }
        },
        "@contractkit/plugin-markdown": {
            "baseDir": "docs/",
            "output": "api-reference.md"
        }
    }
}
```

### Top-level fields

| Field      | Type                | Description                                                                                       |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `rootDir`  | `string`            | Base directory for resolving relative paths. Supports `~` for `$HOME`. Default: `.`               |
| `cache`    | `boolean \| string` | Enable on-disk caching (build hashes + fetched HTTP responses). Pass a string to override the cache directory (default: `.contractkit/cache`). Default: `false` |
| `prettier` | `boolean`           | Format generated TypeScript files with your local prettier. Default: `false`                      |
| `patterns` | `string[]`          | Glob patterns for `.ck` files to compile, relative to `rootDir`                                   |
| `plugins`  | `object`            | Map of plugin package name → options. See plugins below.                                          |

### Built-in plugins

Each plugin is its own npm package and is loaded by listing it under `"plugins"`. The value of each entry is passed to the plugin as `ctx.options`.

| Package                                           | Generates                                                        |
| ------------------------------------------------- | ---------------------------------------------------------------- |
| `@contractkit/plugin-typescript` | Koa routers, TypeScript SDK clients, Zod schemas, plain TS types |
| `@contractkit/plugin-openapi`    | OpenAPI 3.0 YAML                                                 |
| `@contractkit/plugin-markdown`   | Markdown API reference                                           |
| `@contractkit/plugin-bruno`      | Bruno REST collection                                            |
| `@contractkit/plugin-python`     | Python SDK client (Pydantic v2 + httpx)                          |

#### `@contractkit/plugin-typescript`

Has up to four optional sub-configs. Each is independent — include only the ones you need.

##### `server`

Generates Koa router files from `operation` declarations. Optionally also emits Zod schemas or plain TypeScript types from `contract` declarations (used for typing route handlers).

| Field                 | Type      | Description                                                                                         |
| --------------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `baseDir`             | `string`  | Directory (relative to `rootDir`) where server files are written                                    |
| `zod`                 | `boolean` | When true, `output.types` emits Zod schemas. When false/omitted, emits plain TypeScript interfaces. |
| `output.routes`       | `string`  | Path template for Koa router files. Default: `{filename}.router.ts`                                 |
| `output.types`        | `string`  | Path template for type/schema files                                                                 |
| `servicePathTemplate` | `string`  | Import path template for service implementations. Supports `{module}`.                              |
| `includeInternal`     | `boolean` | Whether to emit handlers for `internal` operations. Default: `true`.                                |

##### `sdk`

Generates a typed TypeScript HTTP client. Each operation file becomes a client class; an aggregator class plus a shared `sdk-options.ts` runtime helper file are emitted automatically. Operations marked `internal` are excluded from the SDK by default — set `includeInternal: true` for an internal-use SDK.

| Field             | Type      | Description                                                                                         |
| ----------------- | --------- | --------------------------------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory (relative to `rootDir`) where SDK files are written                                       |
| `name`            | `string`  | Used for the aggregator SDK class name (e.g. `"myapp"` → `MyappSdk`)                                |
| `zod`             | `boolean` | When true, `output.types` emits Zod schemas. When false/omitted, emits plain TypeScript interfaces. |
| `output.sdk`      | `string`  | Path template for the SDK aggregator file. Supports `{name}`. Default: `sdk.ts`                     |
| `output.types`    | `string`  | Path template for SDK type files                                                                    |
| `output.clients`  | `string`  | Path template for client class files                                                                |
| `includeInternal` | `boolean` | Whether to emit SDK methods for `internal` operations. Default: `false`.                            |

##### `zod` and `types`

Standalone generators that emit one Zod (or plain TS) file per `.ck` source file. Use these when you don't need a router or SDK — just schemas/types.

| Field     | Type     | Description                                                                                            |
| --------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `baseDir` | `string` | Directory (relative to `rootDir`) where files are written                                              |
| `output`  | `string` | Path template. Default: `{filename}.schema.ts` (zod) or `{filename}.types.ts` (types) alongside source |

All path templates support `{filename}`, `{dir}`, `{area}`, and (for `output.sdk`) `{name}`. `{area}` resolves to the `area` value declared in the source file's `options { keys: { area: ... } }` block.

#### `@contractkit/plugin-openapi`

| Field             | Type      | Description                                                                          |
| ----------------- | --------- | ------------------------------------------------------------------------------------ |
| `baseDir`         | `string`  | Directory for the output file                                                        |
| `output`          | `string`  | Output filename. Default: `openapi.yaml`                                             |
| `info`            | `object`  | OpenAPI `info` block (`title`, `version`, `description`)                             |
| `servers`         | `array`   | List of `{ url, description }` server entries                                        |
| `security`        | `array`   | Global OpenAPI security requirement                                                  |
| `securitySchemes` | `object`  | Map of scheme name → OpenAPI security scheme (e.g. `{ type, scheme }`)               |
| `includeInternal` | `boolean` | Whether to document `internal` operations. Default: `false`.                         |

Only types referenced by emitted operations are included.

#### `@contractkit/plugin-markdown`

| Field             | Type      | Description                                                          |
| ----------------- | --------- | -------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory for the output file                                        |
| `output`          | `string`  | Output filename. Default: `api-reference.md`                         |
| `includeInternal` | `boolean` | Whether to render `internal` operations. Default: `false`.           |

Unreachable types are excluded.

#### `@contractkit/plugin-bruno`

| Field             | Type      | Description                                                                                       |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory for the output collection                                                               |
| `output`          | `string`  | Output directory name. Default: `bruno-collection`                                                |
| `collectionName`  | `string`  | Bruno collection name. Default: the rootDir basename                                              |
| `auth`            | `object`  | `{ defaultScheme, schemes }` — schemes use the same shape as OpenAPI security schemes plus `hmac` |
| `includeInternal` | `boolean` | Whether to generate request files for `internal` operations. Default: `true`.                     |
| `environments`    | `object`  | Map of environment name → variables. Each entry produces a `environments/<name>.yml` file.        |

Regenerates the output directory cleanly on each run.

#### `@contractkit/plugin-python`

| Field             | Type      | Description                                                                |
| ----------------- | --------- | -------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Output directory relative to `rootDir`. Default: `python-sdk`              |
| `packageName`     | `string`  | Used in the aggregator class name. Default: `Sdk`                          |
| `includeInternal` | `boolean` | Whether to emit client methods for `internal` operations. Default: `false`. |

Emits one Pydantic v2 module per contract file and one httpx client per operation file. Method names follow the same priority as the TS SDK (`sdk:` → `name:` → derived from HTTP verb + path), converted to `snake_case`.

### Writing your own plugin

Plugins implement the `ContractKitPlugin` interface from `@contractkit/core`. Hooks: `transform` (mutate AST per file), `validate` (throw to fail compilation), `generateTargets` (emit output files), and `command` (register a CLI subcommand). See `packages/contractkit/src/plugin.ts`.

---

## DSL Language Reference

Contract files use the `.ck` extension. A file can contain an optional `options` block followed by any number of `contract` and `operation` declarations in any order.

### File Structure

```
options { ... }          # optional — file metadata

contract Foo: { ... }    # type declarations
contract Bar: Foo & { ... }

operation /path: { ... } # route declarations
```

---

### Options Block

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
        roles: admin
    }
}
```

- **`keys`** — arbitrary key/value pairs attached to the file's metadata (e.g. `area` is used for grouping in generated docs). Any key can also be referenced from any string in the file as `{{name}}`; see [Variable substitution](#variable-substitution).
- **`services`** — maps service identifiers to import paths; used in `service:` bindings within operations. Paths starting with `#` are resolved as package-relative imports.
- **`request: { headers }`** — request headers applied to every operation in the file. Op-level headers with the same name override; an operation can opt out entirely with `headers: none`. A name collision with a path parameter raises an error.
- **`response: { headers }`** — response headers applied to every status code on every operation. Per-status override is `headers: { same-name: <type> }`; per-status opt-out is `headers: none`. Note: OpenAPI and Markdown reflect these on every status; the TS server (`ctx.set`) and SDK return shape only emit headers on the primary response (first body-bearing response), matching existing inline-headers behavior.
- **`security`** — file-level default security applied to all operations unless overridden at the route or operation level. Accepts the same syntax as operation-level `security:` blocks.

#### Variable substitution

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

### Contract Declarations

`contract` declares a named type that compiles to a Zod schema and a TypeScript type.

#### Basic Model

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

#### Inheritance

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

#### Type Alias

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

### Contract Modifiers

Modifiers appear between the `contract` keyword and the model name, in any order.

#### `deprecated`

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

#### `mode(strict|strip|loose)`

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

#### `format(input=camel|snake|pascal)` and `format(output=camel|snake|pascal)`

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

### Scalar Types

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

### Compound Types

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

### Type Constraints

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

### Union and Intersection Types

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

### Discriminated Unions

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

### Field Syntax

Fields follow the pattern:

```
name?: [modifiers] TypeExpression [= defaultValue]  # optional comment
```

#### Optionality

`?` after the field name marks it optional:

```
nickname?: string
```

Compiles to `.optional()` on the field's schema.

#### Nullability

Include `null` in a union to allow null values:

```
middleName: string | null
deletedAt: datetime | null
```

Compiles to `.nullable()` on the field's schema.

#### Field Modifiers

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

#### Default Values

```
status: enum(active, inactive) = active
retries: int = 3
label: string = "untitled"
enabled: boolean = true
```

Compiles to `.default(value)` on the schema.

#### Inline Object Types

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

### Descriptions and Comments

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

---

### Operation Declarations

`operation` declares a route with one or more HTTP method handlers. Compiles to a Koa router.

#### Basic Structure

```
operation /path: {
    get: { ... }
    post: { ... }
    put: { ... }
    patch: { ... }
    delete: { ... }
}
```

#### Route Modifiers

Modifiers use function-call syntax on the `operation` keyword:

```
operation(internal) /admin/users: { ... }
operation(deprecated) /v1/users: { ... }
```

| Modifier     | Effect                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `internal`   | By default: excluded from SDK / Python SDK / OpenAPI / Markdown output, included in the server router and Bruno collection. Each plugin accepts an `includeInternal: boolean` config option to override its default. |
| `deprecated` | Adds `@deprecated` JSDoc and `deprecated: true` in OpenAPI output for all operations on this route.     |

Route-level modifiers cascade to all operations. Individual operations can override using the same modifier syntax on the HTTP method verb (see below).

---

### Path Parameters

Declare path parameters with `{paramName}` in the route path:

```
operation /users/{id}: {
    params: {
        id: uuid
    }
    get: { ... }
}
```

Multiple parameters:

```
operation /orgs/{orgId}/members/{memberId}: {
    params: {
        orgId: uuid
        memberId: uuid # the member to fetch
    }
    get: { ... }
}
```

The `params` block can also reference a named contract type:

```
operation /users/{id}: {
    params: UserParams
    get: { ... }
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
    get: { ... }
}

operation /pets/{status}: {
    params: {
        status: enum(available, pending, sold)
    }
    get: { ... }
}
```

The compiler validates that every `{param}` in the path has a corresponding entry in the `params` block and warns on mismatches. Path parameters are compiled to Koa `:param` syntax in the generated router.

---

### HTTP Method Blocks

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

#### Operation Modifiers

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

### Query Parameters

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

### Request Headers

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

### Request Body

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

### Response

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

#### Typed response headers

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

### Security

Security can be declared at the file level (inside the `options` block), at the route level, or at the operation level. It cascades from operation → route → file → config default.

**Explicitly public** (no auth required):

```
post: {
    security: none
    ...
}
```

**Require specific roles** (for RBAC schemes):

```
get: {
    security: {
        roles: admin editor
    }
    ...
}
```

**Named scheme** (references a scheme defined in config):

```
post: {
    security: {
        webhookAuth
    }
    ...
}
```

Route-level security applies to all operations in the route unless overridden:

```
operation /admin/users: {
    security: {
        roles: admin
    }

    get: { ... }     # requires admin role
    post: { ... }    # requires admin role

    delete: {
        security: {
            roles: superadmin   # overridden — requires superadmin
        }
        ...
    }
}
```

---

### Service Binding

Binds the operation to a service method. The service name must be declared in the `options` block.

```
post: {
    service: UserService.create
    ...
}
```

The generated router imports and calls `UserService.create(ctx)`.

---

### SDK Method Name

By default the SDK method name is derived from the route path and HTTP verb. To override it explicitly:

```
get: {
    sdk: getById
    service: UserService.getById
    ...
}
```

---

### Webhook Signature

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

---

### Per-Operation Plugin Extensions

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

## SDK Generation

The TypeScript SDK is produced by the `sdk` sub-config of `@contractkit/plugin-typescript`. The aggregator class, barrel exports, and a shared `sdk-options.ts` runtime helper are emitted automatically.

```typescript
import { MyappSdk } from '@myapp/sdk';

const sdk = new MyappSdk({ baseUrl: 'https://api.example.com' });
const users = await sdk.users.list({ query: { page: 1 } });
```

### Subclient grouping

`keys.area` and `keys.subarea` (set in a file's `options { keys: { ... } }` block) drive how operations cluster on the generated SDK:

| File metadata | Generated layout |
| --- | --- |
| `area: identity, subarea: invitations` | `IdentityInvitationsClient` emitted as a leaf file; exposed as `sdk.identity.invitations.<method>` |
| `area: identity` (no subarea) | methods inlined directly on `IdentityClient` (no standalone `*.client.ts`); exposed as `sdk.identity.<method>` |
| neither | flat top-level property — `sdk.<filename>.<method>` (legacy behavior) |

Multiple files mapping to the same `(area, subarea)` are merged into one client. Multiple area-level files contributing methods that collide on name fail at codegen time with a clear error — disambiguate with `sdk:` or move one into a subarea.

`{subarea}` is available as a path-template variable on `output.clients` and `output.types` alongside `{area}`, `{filename}`, and `{dir}`. Example: `output.clients: "src/{area}/{subarea}.client.ts"` produces `src/identity/invitations.client.ts`.

A Python SDK with the same operation coverage is available via `@contractkit/plugin-python`.

---

## Documentation Generation

OpenAPI 3.0 YAML and Markdown reference are produced by the `@contractkit/plugin-openapi` and `@contractkit/plugin-markdown` plugins respectively. In both, operations marked `internal` and any types unreachable from public operations are excluded.

A Bruno REST collection can be generated via `@contractkit/plugin-bruno`.

---

## Incremental Compilation

The compiler caches file hashes and skips unchanged files on subsequent runs. Set `"cache": true` in your config to enable. The cache directory (`.contractkit/cache` by default) holds both build hashes (`build.json`) and any fetched plugin extension HTTP responses (`http/`); pass a string for `cache` to override the directory. Use `--force` to bypass the cache and recompile everything.

---

## Cross-File Validation

The compiler validates type references across files. If a field or operation references a model that doesn't exist in any parsed file, a warning is emitted.

---

## Prettier Integration

Set `"prettier": true` in your config to format all generated TypeScript files using your project's local prettier installation.

The `@contractkit/prettier-plugin` package formats `.ck` files themselves. Add it to your prettier config:

```json
{
    "plugins": ["@contractkit/prettier-plugin"]
}
```

---

## VS Code Extension

The `@contractkit/vscode-extension` extension provides:

- Syntax highlighting for `.ck` files
- Autocompletion for types, keywords, modifiers, and model references
- Hover information for built-in types and referenced models
- Cross-file model indexing
- Real-time diagnostics from the language server

Requires VS Code or Cursor 1.105.1+.

### Setup

```bash
cd apps/vscode-extension
pnpm install
pnpm run vscode:install
```

---

## Project Structure

All packages publish under the `@contractkit` npm scope.

```
contractkit/
  apps/
    cli/                              # @contractkit/cli — contractkit binary (discovery, config, plugin orchestration)
    vscode-extension/                 # @contractkit/vscode-extension — VS Code / Cursor language support (LSP + TM grammar)
    prettier-plugin/                  # @contractkit/prettier-plugin — Prettier plugin for formatting .ck files
  contracts/                          # Example contract files
  packages/
    contractkit/                      # @contractkit/core — parser, AST, semantics, plugin interface
      src/
        contractkit.ohm               # Ohm PEG grammar (source of truth)
        semantics.ts                  # Parse tree → AST
        parser.ts                     # parseCk() entry point
        ast.ts                        # AST type definitions
        type-utils.ts                 # Type ref collection, topo sort, input-model graph
        apply-options-defaults.ts     # Merges options-level header globals into operations
        validate-refs.ts              # Cross-file type reference validation
        validate-inheritance.ts       # Multi-base inheritance validation
        validate-operation.ts         # Path parameter and operation validation
        plugin.ts                     # ContractKitPlugin / PluginContext interfaces
    plugin-typescript/                # @contractkit/plugin-typescript — Koa routers, TS SDK, Zod schemas, plain TS types
    plugin-openapi/                   # @contractkit/plugin-openapi — OpenAPI 3.0 YAML
    plugin-markdown/                  # @contractkit/plugin-markdown — Markdown API reference
    plugin-bruno/                     # @contractkit/plugin-bruno — Bruno REST collection
    plugin-python/                    # @contractkit/plugin-python — Python SDK (Pydantic v2 + httpx)
    openapi-to-ck/                    # @contractkit/openapi-to-ck — OpenAPI YAML → .ck file converter
    config-typescript/                # Shared tsconfig base
    config-eslint/                    # Shared ESLint config
```
