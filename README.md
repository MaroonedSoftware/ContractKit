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

Create `contractkit.config.json` in your project root:

```json
{
  "rootDir": ".",
  "cache": true,
  "prettier": true,
  "security": {
    "default": "bearer",
    "schemes": {
      "bearer": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT"
      },
      "webhookAuth": {
        "type": "hmac",
        "header": "X-Signature",
        "secretEnv": "WEBHOOK_SECRET",
        "algorithm": "sha256",
        "digest": "hex"
      }
    }
  },
  "server": {
    "baseDir": "apps/api/",
    "types": {
      "include": ["contracts/types/**/*.ck"],
      "output": "src/types"
    },
    "routes": {
      "include": ["contracts/operations/**/*.ck"],
      "output": "src/routes",
      "servicePathTemplate": "#modules/{module}/{module}.service.js",
      "typeImportPathTemplate": "#types/{kebab}.js"
    }
  },
  "sdk": {
    "baseDir": "packages/sdk/",
    "name": "myapp",
    "output": "src/{name}.sdk.ts",
    "types": {
      "include": ["contracts/types/**/*.ck"],
      "output": "src/types"
    },
    "clients": {
      "include": ["contracts/operations/**/*.ck"],
      "output": "src/clients",
      "typeImportPathTemplate": "#sdk/types/{kebab}.js"
    }
  },
  "docs": {
    "openapi": {
      "output": "openapi.yaml",
      "info": {
        "title": "My API",
        "version": "1.0.0"
      },
      "servers": [{ "url": "https://api.example.com" }]
    },
    "markdown": {
      "output": "api-reference.md"
    }
  }
}
```

### Config Reference

| Field      | Type                | Description                                                                                       |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| `rootDir`  | `string`            | Base directory for resolving relative paths. Default: `.`                                         |
| `cache`    | `boolean \| string` | Enable incremental compilation cache. Pass a string for a custom cache filename. Default: `false` |
| `prettier` | `boolean`           | Format generated TypeScript files with your local prettier. Default: `false`                      |
| `patterns` | `string[]`          | Additional glob patterns to include                                                               |
| `security` | `object`            | Global security scheme definitions and default                                                    |
| `server`   | `object`            | Server-side codegen configuration                                                                 |
| `sdk`      | `object`            | SDK/client codegen configuration (opt-in)                                                         |
| `docs`     | `object`            | Documentation generation configuration (opt-in)                                                  |

#### `security`

| Field                        | Type     | Description                                                                     |
| ---------------------------- | -------- | ------------------------------------------------------------------------------- |
| `default`                    | `string` | Default scheme applied when an operation has no explicit `security` declaration |
| `schemes`                    | `object` | Map of scheme name → scheme definition                                          |
| `schemes[name].type`         | `string` | `"http"`, `"apiKey"`, `"oauth2"`, `"openIdConnect"`, or `"hmac"`               |
| `schemes[name].scheme`       | `string` | (http only) `"bearer"`, `"basic"`, etc.                                         |
| `schemes[name].bearerFormat` | `string` | (http/bearer only) e.g. `"JWT"`                                                 |
| `schemes[name].header`       | `string` | (hmac only) Request header carrying the signature                               |
| `schemes[name].secretEnv`    | `string` | (hmac only) Environment variable name holding the HMAC secret                  |
| `schemes[name].algorithm`    | `string` | (hmac only) HMAC algorithm: `"sha256"` or `"sha512"`                            |
| `schemes[name].digest`       | `string` | (hmac only) Output encoding: `"hex"`, `"base64"`, or `"base64url"`             |

HMAC schemes generate `requireSignature('schemeName')` middleware in the router. OpenAPI-type schemes are emitted into the generated spec's `components.securitySchemes`.

#### `server`

| Field                           | Type       | Description                                                         |
| ------------------------------- | ---------- | ------------------------------------------------------------------- |
| `baseDir`                       | `string`   | Base directory for resolving server-side globs                      |
| `types.include`                 | `string[]` | Glob patterns for type `.ck` files                                  |
| `types.output`                  | `string`   | Output directory for generated Zod schemas                          |
| `routes.include`                | `string[]` | Glob patterns for operation `.ck` files                             |
| `routes.output`                 | `string`   | Output directory for generated Koa routers                          |
| `routes.servicePathTemplate`    | `string`   | Template for service import paths (`{module}`, `{name}`, `{kebab}`) |
| `routes.typeImportPathTemplate` | `string`   | Template for type import paths                                      |

#### `sdk`

| Field                            | Type       | Description                                                 |
| -------------------------------- | ---------- | ----------------------------------------------------------- |
| `baseDir`                        | `string`   | Base directory for the SDK package                          |
| `name`                           | `string`   | SDK class name prefix                                       |
| `output`                         | `string`   | Path for the aggregator entry file. Template vars: `{name}` |
| `types.include`                  | `string[]` | Glob patterns for type `.ck` files                          |
| `types.output`                   | `string`   | Output directory for plain TypeScript types (no Zod)        |
| `clients.include`                | `string[]` | Glob patterns for operation `.ck` files                     |
| `clients.output`                 | `string`   | Output directory for client classes                         |
| `clients.typeImportPathTemplate` | `string`   | Template for type imports within the SDK                    |

#### `docs.openapi`

| Field              | Type     | Description                                   |
| ------------------ | -------- | --------------------------------------------- |
| `baseDir`          | `string` | Base directory for the output file            |
| `output`           | `string` | Output filename. Default: `openapi.yaml`      |
| `info.title`       | `string` | API title                                     |
| `info.version`     | `string` | API version                                   |
| `info.description` | `string` | API description                               |
| `servers`          | `array`  | List of `{ url, description }` server entries |

Only types referenced by public (non-`internal`) operations are included in the generated schema.

#### `docs.markdown`

| Field     | Type     | Description                                  |
| --------- | -------- | -------------------------------------------- |
| `baseDir` | `string` | Base directory for the output file           |
| `output`  | `string` | Output filename. Default: `api-reference.md` |

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

Declares file-level metadata: key/value pairs and service import paths.

```
options {
    keys: {
        area: ledger
    }
    services: {
        LedgerService: "#src/modules/ledger/ledger.service.js"
    }
    security: {
        roles: admin
    }
}
```

- **`keys`** — arbitrary key/value pairs attached to the file's metadata (e.g. `area` is used for grouping in generated docs)
- **`services`** — maps service identifiers to import paths; used in `service:` bindings within operations. Paths starting with `#` are resolved as package-relative imports.
- **`security`** — file-level default security applied to all operations unless overridden at the route or operation level. Accepts the same syntax as operation-level `security:` blocks.

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

Use `&` to extend a base model. The generated Zod schema uses `.extend()`.

```
contract Admin: User & {
    permissions: array(string)
    department: string
}
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

| Mode     | Zod Method        | Behavior                             |
| -------- | ----------------- | ------------------------------------ |
| `strict` | `z.strictObject`  | Rejects unknown keys (default)       |
| `strip`  | `z.object`        | Silently removes unknown keys        |
| `loose`  | `z.looseObject`   | Passes unknown keys through          |

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

| Type       | Zod Output                    | Notes                              |
| ---------- | ----------------------------- | ---------------------------------- |
| `string`   | `z.string()`                  |                                    |
| `number`   | `z.coerce.number()`           |                                    |
| `int`      | `z.coerce.number().int()`     |                                    |
| `bigint`   | `z.coerce.bigint()`           |                                    |
| `boolean`  | `z.coerce.boolean()`          |                                    |
| `date`     | `z.string().date()`           | ISO 8601 date string               |
| `time`     | `z.string().time()`           | ISO 8601 time string               |
| `datetime` | Luxon `DateTime`              | Full ISO 8601 datetime             |
| `email`    | `z.string().email()`          |                                    |
| `url`      | `z.string().url()`            |                                    |
| `uuid`     | `z.string().uuid()`           |                                    |
| `unknown`  | `z.unknown()`                 |                                    |
| `null`     | `z.null()`                    | Typically used in union: `T \| null` |
| `object`   | `z.object({})`                | Untyped/passthrough object         |
| `binary`   | `z.custom<Buffer>(...)`       | Node.js Buffer validation          |
| `json`     | Recursive `_ZodJson`          | Any JSON-serializable value        |

---

### Compound Types

Compound types take arguments in parentheses. Arguments may be type expressions, key=value constraint pairs, or literals.

| Syntax                    | Zod Output                                  |
| ------------------------- | ------------------------------------------- |
| `array(T)`                | `z.array(T)`                                |
| `array(T, min=1, max=10)` | `z.array(T).min(1).max(10)`                 |
| `tuple(A, B, C)`          | `z.tuple([A, B, C])`                        |
| `record(K, V)`            | `z.record(K, V)`                            |
| `enum(a, b, c)`           | `z.enum(["a", "b", "c"])`                   |
| `literal("val")`          | `z.literal("val")`                          |
| `literal(42)`             | `z.literal(42)`                             |
| `literal(true)`           | `z.literal(true)`                           |
| `lazy(T)`                 | `z.lazy(() => T)`                           |

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

| Constraint        | Applies To             | Description                      |
| ----------------- | ---------------------- | -------------------------------- |
| `min=N`           | string, number, array  | Minimum length / value / count   |
| `max=N`           | string, number, array  | Maximum length / value / count   |
| `length=N`        | string                 | Exact string length              |
| `regex=/pattern/` | string                 | Regex pattern validation         |
| `format=name`     | string                 | Named format hint (passthrough)  |

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

| Modifier     | Effect                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `internal`   | Excluded from SDK generation, markdown docs, and OpenAPI output. Server router code is still generated.       |
| `deprecated` | Adds `@deprecated` JSDoc and `deprecated: true` in OpenAPI output for all operations on this route.           |

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

## SDK Generation

When `sdk` is configured, the compiler generates a typed HTTP client package alongside the server code.

Each operation `.ck` file produces a client class. An aggregator class and barrel exports are generated automatically. Operations marked `internal` are excluded from the SDK. Only types reachable from public operations are included in the SDK types package.

```typescript
import { MyappSdk } from '@myapp/sdk';

const sdk = new MyappSdk({ baseUrl: 'https://api.example.com' });
const users = await sdk.users.list({ query: { page: 1 } });
```

---

## Documentation Generation

### OpenAPI

When `docs.openapi` is configured, an OpenAPI 3.0 YAML file is generated from all public operations. Only types reachable from public operations are included in the schema components.

### Markdown

When `docs.markdown` is configured, a Markdown API reference is generated. Internal operations and unreachable types are excluded.

---

## Incremental Compilation

The compiler caches file hashes and skips unchanged files on subsequent runs. Set `"cache": true` in your config to enable. Use `--force` to bypass the cache and recompile everything.

---

## Cross-File Validation

The compiler validates type references across files. If a field or operation references a model that doesn't exist in any parsed file, a warning is emitted.

---

## Prettier Integration

Set `"prettier": true` in your config to format all generated TypeScript files using your project's local prettier installation.

The `prettier-plugin-contractkit` package formats `.ck` files themselves. Add it to your prettier config:

```json
{
  "plugins": ["prettier-plugin-contractkit"]
}
```

---

## VS Code Extension

The `contractkit-vscode` extension provides:

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

```
contractkit/
  apps/
    vscode-extension/        # VS Code / Cursor language support
      src/
        server/              # Language server (LSP)
        client/              # VS Code client extension
      syntaxes/              # TextMate grammar for .ck files
      tests/
    prettier-plugin/         # Prettier plugin for .ck files
      src/
        print-ck.ts          # .ck file formatter
        print-op.ts          # Route/operation printing helpers
        print-dto.ts         # Model/contract printing helpers
        print-type.ts        # Type expression and field printing
      tests/
  contracts/                 # Example contract files
  packages/
    contractkit/             # Core parser, AST, and code generators
      src/
        contractkit.ohm       # Ohm PEG grammar (source of truth)
        semantics.ts           # Parse tree → AST
        parser.ts              # parseCk() entry point
        ast.ts                 # AST type definitions
        codegen-contract.ts    # Zod schema generation
        codegen-operation.ts   # Koa router generation
        codegen-sdk.ts         # SDK client generation
        codegen-openapi.ts     # OpenAPI YAML generation
        codegen-markdown.ts    # Markdown docs generation
        codegen-plain-types.ts # Plain TypeScript interface generation
        validate-operation.ts  # Path parameter validation
      tests/
```
