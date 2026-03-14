# Contract DSL

A domain-specific language for defining API contracts. Compiles `.dto` (data transfer object) and `.op` (operation) files into TypeScript code with Zod schemas and Koa routers.

## Quick Start

```bash
# Install dependencies
pnpm install

# Compile contract files
pnpm start

# Run tests
pnpm test
```

### CLI Usage

```bash
dsl-compile [options]

Options:
  -c, --config <path>  Path to config file (default: searches for contract-dsl.config.json)
  -w, --watch          Watch for changes and recompile
      --force          Skip incremental cache, recompile all
```

The compiler searches upward from the current directory for `contract-dsl.config.json`. All configuration is done through the config file.

## Configuration File

Create `contract-dsl.config.json` in your project root (or any parent directory):

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
            "include": ["contracts/types/**/*.dto"],
            "output": "src/types"
        },
        "routes": {
            "include": ["contracts/operations/**/*.op"],
            "output": "src/routes",
            "servicePathTemplate": "#modules/{module}/{module}.service.js",
            "typeImportPathTemplate": "#types/{kebab}.dto.js"
        }
    },
    "sdk": {
        "baseDir": "packages/sdk/",
        "name": "myapp",
        "output": "src/{name}.sdk.ts",
        "types": {
            "include": ["contracts/types/**/*.dto"],
            "output": "src/types"
        },
        "clients": {
            "include": ["contracts/operations/**/*.op"],
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
| `patterns` | `string[]`          | Additional glob patterns to include (supplements `server` and `sdk` includes)                     |
| `security` | `object`            | Global security scheme definitions and default                                                    |
| `server`   | `object`            | Server-side codegen configuration                                                                 |
| `sdk`      | `object`            | SDK/client codegen configuration (opt-in)                                                         |
| `docs`     | `object`            | Documentation generation configuration (opt-in)                                                   |

#### `security`

| Field                              | Type     | Description                                                                              |
| ---------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `default`                          | `string` | Default scheme name applied when an operation has no explicit `security` declaration      |
| `schemes`                          | `object` | Map of scheme name → scheme definition                                                   |
| `schemes[name].type`               | `string` | `"http"`, `"apiKey"`, `"oauth2"`, `"openIdConnect"`, or `"hmac"`                        |
| `schemes[name].scheme`             | `string` | (http only) `"bearer"`, `"basic"`, etc.                                                  |
| `schemes[name].bearerFormat`       | `string` | (http/bearer only) e.g. `"JWT"`                                                          |
| `schemes[name].header`             | `string` | (hmac only) Request header carrying the signature, e.g. `"X-Signature"`                  |
| `schemes[name].secretEnv`          | `string` | (hmac only) Environment variable name holding the HMAC secret, e.g. `"WEBHOOK_SECRET"`  |
| `schemes[name].algorithm`          | `string` | (hmac only) HMAC algorithm: `"sha256"` or `"sha512"`                                    |
| `schemes[name].digest`             | `string` | (hmac only) Output encoding: `"hex"`, `"base64"`, or `"base64url"`                      |

HMAC schemes generate `requireSignature('schemeName')` middleware in the router. OpenAPI-type schemes are emitted into the generated spec's `components.securitySchemes`.

#### `server`

| Field                           | Type       | Description                                                         |
| ------------------------------- | ---------- | ------------------------------------------------------------------- |
| `baseDir`                       | `string`   | Base directory for resolving server-side globs                      |
| `types.include`                 | `string[]` | Glob patterns for `.dto` files                                      |
| `types.output`                  | `string`   | Output directory (or template) for generated Zod schemas            |
| `routes.include`                | `string[]` | Glob patterns for `.op` files                                       |
| `routes.output`                 | `string`   | Output directory (or template) for generated Koa routers            |
| `routes.servicePathTemplate`    | `string`   | Template for service import paths (`{module}`, `{name}`, `{kebab}`) |
| `routes.typeImportPathTemplate` | `string`   | Template for type import paths                                      |

#### `sdk`

| Field                            | Type       | Description                                                 |
| -------------------------------- | ---------- | ----------------------------------------------------------- |
| `baseDir`                        | `string`   | Base directory for the SDK package                          |
| `name`                           | `string`   | SDK class name prefix                                       |
| `output`                         | `string`   | Path for the aggregator entry file. Template vars: `{name}` |
| `types.include`                  | `string[]` | Glob patterns for `.dto` files to include in SDK types      |
| `types.output`                   | `string`   | Output directory for plain TypeScript types (no Zod)        |
| `clients.include`                | `string[]` | Glob patterns for `.op` files                               |
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
| `securitySchemes`  | `object` | OpenAPI security scheme definitions           |
| `security`         | `array`  | Global security requirements                  |

Only types referenced by public (non-`internal`) operations are included in the generated schema. Types used only by internal operations are automatically excluded.

#### `docs.markdown`

| Field     | Type     | Description                                  |
| --------- | -------- | -------------------------------------------- |
| `baseDir` | `string` | Base directory for the output file           |
| `output`  | `string` | Output filename. Default: `api-reference.md` |

## DSL Language Reference

### DTO Files (`.dto`)

Define data models that compile to Zod schemas.

#### Basic Model

```
User {
    id: readonly uuid
    name: string
    email: email
    age?: int
    active: boolean = true
}
```

#### Inheritance

```
Admin: User {
    role: enum(admin, superadmin)
    permissions: array(string)
}
```

#### Scalar Types

| Type       | Zod Output             |
| ---------- | ---------------------- |
| `string`   | `z.string()`           |
| `number`   | `z.number()`           |
| `int`      | `z.number().int()`     |
| `bigint`   | `z.bigint()`           |
| `boolean`  | `z.boolean()`          |
| `date`     | `z.string().date()`    |
| `datetime` | Luxon `DateTime`       |
| `email`    | `z.string().email()`   |
| `url`      | `z.string().url()`     |
| `uuid`     | `z.string().uuid()`    |
| `any`      | `z.any()`              |
| `unknown`  | `z.unknown()`          |
| `null`     | `z.null()`             |
| `object`   | `z.object({})`         |
| `binary`   | `z.instanceof(Buffer)` |

#### Compound Types

| Syntax           | Zod Output                |
| ---------------- | ------------------------- |
| `array(T)`       | `z.array(T)`              |
| `tuple(A, B)`    | `z.tuple([A, B])`         |
| `record(K, V)`   | `z.record(K, V)`          |
| `enum(a, b, c)`  | `z.enum(["a", "b", "c"])` |
| `literal("val")` | `z.literal("val")`        |
| `lazy(T)`        | `z.lazy(() => T)`         |
| `A \| B`         | `z.union([A, B])`         |

#### Field Modifiers

- **`readonly`** — Field only in read schema (excluded from write/input schema)
- **`writeonly`** — Field only in write schema (excluded from read schema)
- **`?`** — Optional (nullable) field
- **`= value`** — Default value

When a model uses `readonly` or `writeonly` modifiers, the compiler generates a three-schema pattern: `ModelBase`, `Model` (read), and `ModelInput` (write).

#### Constraints

```
code: string(length=3)
name: string(min=1, max=100)
age: int(min=0, max=150)
tags: array(string, min=1, max=10)
slug: string(regex=[a-z0-9-]+)
```

| Constraint      | Applies To            | Description                |
| --------------- | --------------------- | -------------------------- |
| `min=N`         | string, number, array | Minimum length/value/count |
| `max=N`         | string, number, array | Maximum length/value/count |
| `length=N`      | string                | Exact length               |
| `regex=PATTERN` | string                | Regex validation           |

#### Descriptions

```
# Represents a user account
User {
    name: string   # Full display name
    email: email   # Primary contact email
}
```

Comments with `#` before a model become descriptions. Inline `#` comments on fields are preserved as `.describe()` calls in generated code.

### Operation Files (`.op`)

Define API endpoints that compile to Koa router code.

#### Basic Route

```
/users {
    get
    post
}
```

#### Full Route with Parameters

```
# Account management
/accounts/:accountId {
    params {
        accountId: uuid
    }

    # Get account details
    get {
        response {
            200 {
                application/json: Account
            }
        }
    }

    put {
        request {
            application/json: UpdateAccountInput
        }
        response {
            200 {
                application/json: Account
            }
        }
    }

    delete {
        response {
            204
        }
    }
}
```

#### HTTP Methods

`get`, `post`, `put`, `patch`, `delete`

#### Route Modifiers

Modifiers appear after `:` on route or operation declarations:

```
# Exclude from SDK and API docs (server code still generated)
/admin/users: internal {
    get
    post
}

# Mark as deprecated
/v1/users: deprecated {
    get
}

# Override route-level internal for a specific operation
/admin/users: internal {
    get: public {
        response { 200 { application/json: array(User) } }
    }
    post   # still internal
}
```

| Modifier     | Scope              | Effect                                                                                                         |
| ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `internal`   | route or operation | Excluded from SDK client generation, markdown docs, and OpenAPI output. Server router code is still generated. |
| `deprecated` | route or operation | Adds `@deprecated` JSDoc and `deprecated: true` in OpenAPI output.                                             |
| `public`     | operation only     | Overrides a route-level `internal` modifier to make a specific operation public.                               |

Operation-level modifiers replace (not merge with) route-level modifiers. Use `public` to selectively expose individual operations on an otherwise-internal route.

#### Path Parameters

Declare with `:paramName` in the route path. Define types in a `params` block:

```
/users/:id {
    params {
        id: uuid
    }
    get
}
```

Or reference a type:

```
/users/:id {
    params: UserParams
    get
}
```

The compiler warns if path parameters are not declared in a `params` block.

#### Query Parameters

Inline or as a type reference:

```
get {
    query {
        page: int
        limit: int
    }
}

# Or:
get {
    query: PaginationQuery
}
```

#### Headers

```
get {
    headers {
        authorization: string
        x-request-id: uuid
    }
}
```

#### Request Body

```
post {
    request {
        application/json: CreateUserInput
    }
}
```

Supported content types: `application/json`, `multipart/form-data`

#### Response

```
get {
    response {
        200 {
            application/json: array(User)
        }
    }
}

delete {
    response {
        204
    }
}
```

#### Security

Use `security: none` to mark an endpoint as public, or `security { ... }` block form to require a specific scheme with optional OAuth scopes:

```
# Route-level security — applies to all operations in the block
/webhooks/stripe {
    security {
        webhookAuth
    }
    post {
        request {
            application/json: StripeEvent
        }
    }
}

/users/:id {
    # Inline block form with scopes
    get {
        security {
            bearer "read:users"
        }
        response {
            200 { application/json: User }
        }
    }

    # Explicitly public — overrides any route-level or default security
    delete {
        security: none
        response { 204 }
    }
}
```

Security cascades in priority order: operation-level → route-level → `security.default` in config.

Scheme names must match a key in `security.schemes`. HMAC schemes generate a `requireSignature('schemeName')` middleware call in the Koa router; standard OpenAPI schemes emit a `@security` annotation and appear in the generated OpenAPI spec.

#### Service Binding

```
post {
    service: TransfersService.create
    request {
        application/json: CreateTransferIntent
    }
    response {
        201 {
            application/json: TransferIntent
        }
    }
}
```

#### Comments / Descriptions

```
# Route-level description
/users {
    # Operation-level description
    get
}
```

Comments before routes and operations are emitted as JSDoc in generated code.

## SDK Generation

When `sdk` is configured, the compiler generates a typed HTTP client package alongside the server code.

Each `.op` file produces a client class (e.g. `users.op` → `UsersClient`). An aggregator class and barrel exports are generated automatically.

Operations marked `internal` are excluded from the SDK. Only types reachable from public operations are included in the SDK types package.

```typescript
import { MyappSdk } from '@myapp/sdk';

const sdk = new MyappSdk({ baseUrl: 'https://api.example.com' });
const users = await sdk.users.list({ query: { page: 1 } });
```

## Documentation Generation

### OpenAPI

When `docs.openapi` is configured, an OpenAPI 3.0 YAML file is generated from all public (non-`internal`) operations. The generated schema includes only types reachable from those public operations.

### Markdown

When `docs.markdown` is configured, a Markdown API reference is generated. Internal operations are excluded.

## Incremental Compilation

The compiler caches file hashes and skips unchanged files on subsequent runs. Set `"cache": true` in your config to enable. Use `--force` to bypass the cache and recompile everything.

## Cross-File Validation

The compiler validates type references across files. If a `.dto` field references a model name that doesn't exist in any parsed file, or an `.op` response references an undefined type, a warning is emitted.

## Prettier Integration

Set `"prettier": true` in your config to format all generated TypeScript files using your project's local prettier installation (must be installed as a `devDependency`). Prettier config is resolved per-file using your existing `.prettierrc` or `prettier.config.js`.

## VS Code Extension

The `contract-dsl-vscode` extension provides:

- Syntax highlighting for `.dto` and `.op` files
- Autocompletion for types, keywords, and model references
- Hover information for built-in types and referenced models
- Cross-file model indexing
- Diagnostics from the language server

### Setup

1. Build the extension:
    ```bash
    cd apps/vscode-extension
    pnpm install && pnpm build
    ```
2. Install in VS Code via the generated `.vsix` file, or use the Extension Development Host (`F5` from the extension directory).

## Prettier Plugin

The `prettier-plugin-contract-dsl` package provides formatting for `.dto` and `.op` files via prettier. Add it to your prettier config:

```json
{
    "plugins": ["prettier-plugin-contract-dsl"]
}
```

## Project Structure

```
contract-dsl/
  apps/
    cli/                     # Compiler CLI (dsl-compile)
      src/
        ast.ts               # AST type definitions
        parser-dto.ts        # .dto file parser
        parser-op.ts         # .op file parser
        codegen-dto.ts       # Zod schema code generation
        codegen-op.ts        # Koa router code generation
        codegen-sdk.ts       # SDK client code generation
        codegen-plain-types.ts  # Plain TypeScript types (no Zod)
        codegen-openapi.ts   # OpenAPI YAML generation
        codegen-markdown.ts  # Markdown docs generation
        validate-op.ts       # Operation validation
        validate-refs.ts     # Cross-file type reference validation
        config.ts            # Configuration file loading
        cache.ts             # Incremental compilation cache
        cli.ts               # CLI entry point
      tests/                 # Test suite
    vscode-extension/        # VS Code language support
      src/
        server/              # Language server (LSP)
        client/              # VS Code client extension
  contracts/                 # Example contract files
    types/                   # .dto files
    operations/              # .op files
  packages/
    prettier-plugin-contract-dsl/  # Prettier plugin for .dto and .op files
```
