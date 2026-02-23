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
dsl-compile [files/globs...] [options]

Options:
  -o, --out-dir <path>          Output directory for generated files
  -w, --watch                   Watch for changes and recompile
  --service-path <template>     Service module path template
  --force                       Skip incremental cache, recompile all
```

Examples:

```bash
dsl-compile src/contracts/**/*.dto --out-dir dist/types
dsl-compile user.dto ledger.op --out-dir out
dsl-compile --service-path "#services/{kebab}.service.js"
```

## Configuration File

Create `contract-dsl.config.json` in your project root (or any parent directory):

```json
{
  "outDir": "dist/generated",
  "patterns": ["contracts/**/*.{dto,op}"],
  "servicePathTemplate": "#services/{kebab}.service.js",
  "typeImportPathTemplate": "#types/{kebab}.dto.js"
}
```

CLI flags override config file values. The compiler searches upward from the current directory for the config file.

| Field | Description |
|-------|-------------|
| `outDir` | Output directory for generated files |
| `patterns` | Glob patterns for source files |
| `servicePathTemplate` | Template for service import paths (`{name}`, `{kebab}`, `{module}`) |
| `typeImportPathTemplate` | Template for type import paths (`{name}`, `{kebab}`, `{module}`) |

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

| Type | Zod Output |
|------|------------|
| `string` | `z.string()` |
| `number` | `z.number()` |
| `int` | `z.number().int()` |
| `bigint` | `z.bigint()` |
| `boolean` | `z.boolean()` |
| `date` | `z.string().date()` |
| `datetime` | Luxon `DateTime` |
| `email` | `z.string().email()` |
| `url` | `z.string().url()` |
| `uuid` | `z.string().uuid()` |
| `any` | `z.any()` |
| `unknown` | `z.unknown()` |
| `null` | `z.null()` |
| `object` | `z.object({})` |
| `binary` | `z.instanceof(Buffer)` |

#### Compound Types

| Syntax | Zod Output |
|--------|------------|
| `array(T)` | `z.array(T)` |
| `tuple(A, B)` | `z.tuple([A, B])` |
| `record(K, V)` | `z.record(K, V)` |
| `enum(a, b, c)` | `z.enum(["a", "b", "c"])` |
| `literal("val")` | `z.literal("val")` |
| `lazy(T)` | `z.lazy(() => T)` |
| `A \| B` | `z.union([A, B])` |

#### Field Modifiers

- **`readonly`** -- Field only in read schema (excluded from write/input schema)
- **`writeonly`** -- Field only in write schema (excluded from read schema)
- **`?`** -- Optional (nullable) field
- **`= value`** -- Default value

When a model uses `readonly` or `writeonly` modifiers, the compiler generates a three-schema pattern: `ModelBase`, `Model` (read), and `ModelInput` (write).

#### Constraints

```
code: string(length=3)
name: string(min=1, max=100)
age: int(min=0, max=150)
tags: array(string, min=1, max=10)
slug: string(regex=[a-z0-9-]+)
```

| Constraint | Applies To | Description |
|------------|-----------|-------------|
| `min=N` | string, number, array | Minimum length/value/count |
| `max=N` | string, number, array | Maximum length/value/count |
| `length=N` | string | Exact length |
| `regex=PATTERN` | string | Regex validation |

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

## Project Structure

```
contract-dsl/
  apps/
    cli/                 # Compiler CLI (dsl-compile)
      src/
        ast.ts           # AST type definitions
        parser-dto.ts    # .dto file parser
        parser-op.ts     # .op file parser
        codegen-dto.ts   # Zod schema code generation
        codegen-op.ts    # Koa router code generation
        validate-op.ts   # Operation validation
        validate-refs.ts # Cross-file type reference validation
        config.ts        # Configuration file loading
        cache.ts         # Incremental compilation cache
        cli.ts           # CLI entry point
      tests/             # Test suite
    vscode-extension/    # VS Code language support
      src/
        server/          # Language server (LSP)
        client/          # VS Code client extension
  contracts/             # Example contract files
    types/               # .dto files
    operations/          # .op files
  packages/
    parser/              # Shared Chevrotain lexer/parser
```

## Incremental Compilation

When using `--out-dir`, the compiler caches file hashes and skips unchanged files on subsequent runs. Use `--force` to bypass the cache and recompile everything.

## Cross-File Validation

The compiler validates type references across files. If a `.dto` field references a model name that doesn't exist in any parsed file, or an `.op` response references an undefined type, a warning is emitted.
