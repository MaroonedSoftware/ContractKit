# ContractKit — Claude Guide

## What this project is

A domain-specific language for defining API contracts in `.ck` files. The compiler transforms those files into:

- **Zod schemas** — runtime validation for server-side TypeScript
- **Koa routers** — typed route handlers with request/response validation
- **TypeScript SDK clients** — typed fetch clients for consumers
- **OpenAPI 3.0 YAML** — standard API spec
- **Markdown docs** — human-readable API reference

## Repository layout

```
packages/
  contractkit/                    # Core compiler library (@maroonedsoftware/contractkit)
  openapi-to-ck/                  # Converts OpenAPI YAML → .ck files
  contractkit-plugin-typescript/  # TypeScript codegen: Koa routers, SDK clients, Zod schemas, plain types
  contractkit-plugin-openapi/     # OpenAPI 3.0 YAML generation
  contractkit-plugin-markdown/    # Markdown API reference generation
  contractkit-plugin-bruno/       # Bruno collection generation
  contractkit-plugin-python/      # Python SDK generation (Pydantic v2 + httpx)
  config-typescript/              # Shared tsconfig base
  config-eslint/                  # Shared ESLint config

apps/
  cli/                 # contractkit binary — file discovery, config loading, plugin orchestration
  vscode-extension/    # LSP server + syntax highlighting for .ck files
  prettier-plugin/     # Prettier plugin to format .ck files

contracts/             # Example / test .ck contract files
```

## Running tests

```bash
# All packages
pnpm test

# Core compiler only
pnpm --filter @maroonedsoftware/contractkit test

# TypeScript plugin only
pnpm --filter @maroonedsoftware/contractkit-plugin-typescript test

# Specific test file
pnpm --filter @maroonedsoftware/contractkit exec vitest run tests/parser-ck.test.ts
```

## Key source files

### Core compiler (`packages/contractkit/src/`)

| File                    | Role                                                                                     |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `contractkit.ohm`       | PEG grammar — source of truth for the language                                           |
| `semantics.ts`          | Ohm parse tree → typed AST                                                               |
| `parser.ts`             | `parseCk(source, file, diag)` entry point                                                |
| `ast.ts`                | All AST node types                                                                       |
| `type-utils.ts`         | Generic model/graph utilities — type ref collection, topo sort, `computeModelsWithInput` |
| `validate-operation.ts` | Validates op AST against config constraints                                              |
| `plugin.ts`             | `ContractKitPlugin` and `PluginContext` interface types                                  |

### TypeScript plugin (`packages/contractkit-plugin-typescript/src/`)

| File                     | Role                                                                        |
| ------------------------ | --------------------------------------------------------------------------- |
| `index.ts`               | Combined plugin — server, SDK, Zod, and plain-types generation              |
| `codegen-contract.ts`    | Generates Zod schemas from `contract` declarations                          |
| `codegen-operation.ts`   | Generates Koa routers from `operation` declarations                         |
| `codegen-sdk.ts`         | TypeScript SDK client codegen                                               |
| `codegen-plain-types.ts` | Plain TypeScript interface/type codegen (no Zod runtime)                    |
| `ts-render.ts`           | TypeScript type rendering — `renderTsType`, `renderInputTsType`, `quoteKey` |
| `path-utils.ts`          | Output path template resolution shared across all sub-generators            |

### CLI (`apps/cli/src/`)

| File        | Role                                                          |
| ----------- | ------------------------------------------------------------- |
| `cli.ts`    | Entry point — file discovery, config loading, plugin dispatch |
| `config.ts` | Loads and validates `contractkit.config.json`                 |
| `cache.ts`  | Incremental build (file hashing, skip unchanged files)        |
| `plugin.ts` | Plugin loading, context creation, cache fingerprinting        |

### Other

| File                                                | Role                              |
| --------------------------------------------------- | --------------------------------- |
| `apps/vscode-extension/syntaxes/ck.tmLanguage.json` | TextMate grammar for highlighting |
| `apps/prettier-plugin/src/print-*.ts`               | Idempotent `.ck` file formatter   |

## Test files

Core parser tests live in `packages/contractkit/tests/`:

| File                             | What it tests                                                          |
| -------------------------------- | ---------------------------------------------------------------------- |
| `parser-ck.test.ts`              | Full grammar coverage — contracts, operations, options block, combined |
| `diagnostics.test.ts`            | Error/warning collection                                               |
| `validate-discriminated.test.ts` | Discriminated-union validation (member shape, discriminator field)     |
| `helpers.ts`                     | AST builder helpers                                                    |

TypeScript plugin tests live in `packages/contractkit-plugin-typescript/tests/`:

| File                          | What it tests                                       |
| ----------------------------- | --------------------------------------------------- |
| `codegen-contract.test.ts`    | Zod schema generation from `contract` declarations  |
| `codegen-operation.test.ts`   | Koa router generation from `operation` declarations |
| `codegen-sdk.test.ts`         | SDK client generation                               |
| `codegen-plain-types.test.ts` | Plain TypeScript interface generation               |
| `codegen-server.test.ts`      | Koa router generation via the plugin                |
| `pipeline.test.ts`            | End-to-end parse → codegen flow                     |
| `helpers.ts`                  | AST builder helpers                                 |

## Plugin system

Plugins are configured in `contractkit.config.json` under `"plugins"`. Each key is the npm package name and its value is passed as `ctx.options` to the plugin.

The `@maroonedsoftware/contractkit-plugin-typescript` plugin handles all TypeScript output via sub-configs:

```json
"@maroonedsoftware/contractkit-plugin-typescript": {
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
        "name": "homegrown",
        "zod": true,
        "output": {
            "sdk": "src/{name}.sdk.ts",
            "types": "src/{area}/types/{filename}.ts",
            "clients": "src/{area}/{filename}.client.ts"
        }
    }
}
```

Each sub-config is optional. `zod: true` makes `output.types` emit Zod schemas (via `generateContract`) instead of plain TypeScript interfaces. Path templates support `{filename}`, `{dir}`, `{area}`, and `{name}`.

SDK method names follow this priority: `sdk:` field → `name:` field (converted to camelCase) → inferred from HTTP method + path. The Python SDK plugin uses the same priority but converts to `snake_case`.

The SDK emits a shared `sdk-options.ts` alongside the client files. It contains `SdkOptions`, `createSdkFetch`, `buildQueryString`, `parseJson<T>`, and bigint JSON helpers. Void operations (no response body) skip body consumption entirely.

The plugin interface is defined in `packages/contractkit/src/plugin.ts`. Hooks:

- `transform` — mutate the AST per file before validation
- `validate` — throw to fail compilation
- `generateTargets` — called once after all files are parsed; call `ctx.emitFile()` for each output
- `command` — register a CLI subcommand (`contractkit <name>`)

## The language

```
options {
    keys: { area: payments }
    services: { PaymentsService: "#src/services/payments.service.js" }
    security: { roles: admin }
}

# A payment record
contract Payment: {
    id: readonly uuid
    amount: number(min=0)
    currency: string(len=3)
    status: enum(pending, completed, failed) = pending
    metadata?: record(string, string)
    createdAt: readonly datetime
}

operation(internal) /payments/{id}: {
    params: { id: uuid }

    get: {
        sdk: getPayment
        name: "Get Payment"
        service: PaymentsService.getById
        response: {
            200: { application/json: Payment }
            404:
        }
    }

    patch: {
        service: PaymentsService.update
        request: { application/json: PaymentUpdateInput }
        response: {
            200: { application/json: Payment }
        }
    }
}
```

### Contract modifiers

| Modifier                              | Effect                                   |
| ------------------------------------- | ---------------------------------------- |
| `deprecated`                          | Marks model as deprecated                |
| `mode(strict\|strip\|loose)`          | Controls how Zod handles unknown keys    |
| `format(input=camel\|snake\|pascal)`  | Transforms key casing when parsing input |
| `format(output=camel\|snake\|pascal)` | Transforms key casing on output          |

### Field modifiers

| Modifier                 | Effect                                                 |
| ------------------------ | ------------------------------------------------------ |
| `?` suffix on field name | Optional field                                         |
| `readonly`               | Field excluded from Input schema                       |
| `writeonly`              | Field excluded from Read schema                        |
| `deprecated`             | Marks field as deprecated                              |
| `= value`                | Default value (string, number, boolean, or identifier) |

### Zod schema generation (codegen-contract)

Models with visibility modifiers generate up to three schemas:

- **`ModelBase`** — all fields including writeonly (only when writeonly fields exist)
- **`Model`** (Read) — no writeonly fields; extends `ModelBase` when it exists
- **`ModelInput`** — no readonly fields (only when readonly/writeonly fields exist)

`format(input=)` generates a `.transform()` that remaps keys from the incoming casing to camelCase internally. `format(output=)` remaps from camelCase to the output casing. Both can be combined.

### Discriminated unions

`discriminated(by=<field>, A | B | C)` compiles to `z.discriminatedUnion("field", [...])` in Zod, an `Annotated[Union[...], Field(discriminator=...)]` in Python, and `oneOf` + `discriminator.mapping` in OpenAPI. Validated at parse time in `validate-discriminated.ts` — every member must be a model ref or inline object containing the discriminator as a `literal()`/`enum()` field, and at least two members are required. Failures emit warnings, not errors.

### Response headers

A status code body can declare `headers: { name?: type, ... }` alongside `application/json:`. AST: `OpResponseNode.headers?: OpResponseHeaderNode[]`. When present:

- **OpenAPI** emits `headers:` under the response with `schema`/`required`/`description`.
- **TS SDK** changes the method return shape to `Promise<{ data: T; headers: { ... } }>` (or `Promise<{ headers: ... }>` for void). Header property names are camelCased via `headerNameToProperty` in `ts-render.ts`.
- **TS router** types the service result as `{ body, headers }` and emits `ctx.set(name, String(value))` per header (guarded by `!== undefined` for optional headers).
- **Markdown** renders a "Response headers" table.
- **Python SDK** and **Bruno** plugins are unaware — declared response headers do not surface there yet.

Header values are always read as strings from `Headers.get()`; declaring a non-`string` type is allowed but no runtime parsing/coercion is generated.

### Scalar types worth knowing

- `datetime` → Luxon `DateTime`
- `interval` → Luxon `Interval`; `_ZodInterval` parses an ISO 8601 interval string and `.transform()`s back to ISO on output
- `bigint` → `z.coerce.bigint()`; SDK generates bigint-aware JSON helpers in `sdk-options.ts`

## Grammar conventions (contractkit.ohm)

- **PascalCase rules** — syntactic (Ohm auto-skips whitespace)
- **camelCase rules** — lexical (no whitespace skipping)
- Keywords must be defined as lexical rules with `~identPart` guards to avoid whitespace-skipping issues in syntactic rules

When changing the grammar, also update:

1. `semantics.ts` — add/update the corresponding action
2. `ast.ts` — add/update the AST node type if needed
3. `ck.tmLanguage.json` — update syntax highlighting regex
4. `apps/prettier-plugin/src/print-*.ts` — update the formatter to round-trip the new syntax
5. `parser-ck.test.ts` — add a parser test
6. All affected codegen files and their tests
7. `README.md` — update language reference / examples if the surface syntax changed
8. `CLAUDE.md` - update as needed

## VS Code extension

After changing `ck.tmLanguage.json`, reinstall the extension for changes to take effect:

```bash
pnpm run vscode:install
```

## Naming conventions

The project uses `contract` and `operation` terminology throughout.

- Source: `codegen-contract.ts`, `codegen-operation.ts`, `validate-operation.ts`
- Tests: `codegen-contract.test.ts`, `codegen-operation.test.ts`
- Describe blocks: `generateContract`, `generateOperation`
