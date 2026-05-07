# ContractKit — Claude Guide

## What this project is

A domain-specific language for defining API contracts in `.ck` files. The compiler transforms those files into:

- **Zod schemas** — runtime validation for server-side TypeScript
- **Koa routers** — typed route handlers with request/response validation
- **TypeScript SDK clients** — typed fetch clients for consumers
- **OpenAPI 3.0 YAML** — standard API spec
- **Markdown docs** — human-readable API reference

## Repository layout

All packages publish under the `@contractkit` npm scope.

```
packages/
  contractkit/         # Core compiler library (@contractkit/core)
  openapi-to-ck/       # Converts OpenAPI YAML → .ck files (@contractkit/openapi-to-ck)
  plugin-typescript/   # TypeScript codegen: Koa routers, SDK clients, Zod schemas, plain types
  plugin-openapi/      # OpenAPI 3.0 YAML generation
  plugin-markdown/     # Markdown API reference generation
  plugin-bruno/        # Bruno collection generation
  plugin-python/       # Python SDK generation (Pydantic v2 + httpx)
  config-typescript/   # Shared tsconfig base
  config-eslint/       # Shared ESLint config

apps/
  cli/                 # contractkit binary — file discovery, config loading, plugin orchestration (@contractkit/cli)
  vscode-extension/    # LSP server + syntax highlighting for .ck files (@contractkit/vscode-extension)
  prettier-plugin/     # Prettier plugin to format .ck files (@contractkit/prettier-plugin)

contracts/             # Example / test .ck contract files
```

## Running tests

```bash
# All packages
pnpm test

# Core compiler only
pnpm --filter @contractkit/core test

# TypeScript plugin only
pnpm --filter @contractkit/plugin-typescript test

# Specific test file
pnpm --filter @contractkit/core exec vitest run tests/parser-ck.test.ts
```

## Key source files

### Core compiler (`packages/contractkit/src/`)

| File                       | Role                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `contractkit.ohm`          | PEG grammar — source of truth for the language                                                                         |
| `grammar.ts`               | Compiled Ohm grammar loader                                                                                            |
| `semantics.ts`             | Ohm parse tree → typed AST                                                                                             |
| `parser.ts`                | `parseCk(source, file, diag)` entry point                                                                              |
| `ast.ts`                   | All AST node types                                                                                                     |
| `type-builders.ts`         | Helpers used by `semantics.ts` to construct AST type nodes                                                             |
| `type-utils.ts`            | Generic model/graph utilities — type ref collection, topo sort, `computeModelsWithInput`, `resolveModelFields`         |
| `decompose.ts`             | Splits a parsed file into per-decl groups for cache fingerprinting and downstream codegen                              |
| `apply-options-defaults.ts`| Normalization pass — merges file-level `options { request/response: { headers } }` into each operation's headers       |
| `content-type.ts`          | Content-type parsing/normalization (`application/json`, `multipart/form-data`)                                         |
| `diagnostics.ts`           | `Diagnostics` collector for errors and warnings                                                                        |
| `validate-refs.ts`         | Cross-file type reference validation                                                                                   |
| `validate-inheritance.ts`  | Multi-base inheritance validation (cross-base conflicts, `override` requirement, cycle detection)                      |
| `validate-operation.ts`    | Validates op AST against config constraints                                                                            |
| `plugin.ts`                | `ContractKitPlugin` and `PluginContext` interface types                                                                |
| `index.ts`                 | Public package exports                                                                                                 |

### TypeScript plugin (`packages/plugin-typescript/src/`)

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

| File           | Role                                                          |
| -------------- | ------------------------------------------------------------- |
| `cli.ts`       | Entry point — file discovery, config loading, plugin dispatch |
| `config.ts`    | Loads and validates `contractkit.config.json`                 |
| `cache.ts`     | Incremental build (file hashing, skip unchanged files)        |
| `plugin.ts`    | Plugin loading, context creation, cache fingerprinting        |
| `path-utils.ts`| `rootDir`/`baseDir` resolution shared with plugins            |

### Other

| File                                                | Role                              |
| --------------------------------------------------- | --------------------------------- |
| `apps/vscode-extension/syntaxes/ck.tmLanguage.json` | TextMate grammar for highlighting |
| `apps/prettier-plugin/src/print-*.ts`               | Idempotent `.ck` file formatter   |

## Test files

Core parser tests live in `packages/contractkit/tests/`:

| File                              | What it tests                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `parser-ck.test.ts`               | Full grammar coverage — contracts, operations, options block, combined                         |
| `diagnostics.test.ts`             | Error/warning collection                                                                       |
| `validate-discriminated.test.ts`  | Discriminated-union validation (member shape, discriminator field)                             |
| `validate-inheritance.test.ts`    | Multi-base inheritance — cross-base conflicts, `override` requirement, cycle detection         |
| `apply-options-defaults.test.ts`  | Options-level header globals merge — request/response header propagation, opt-outs, collisions |
| `helpers.ts`                      | AST builder helpers                                                                            |

TypeScript plugin tests live in `packages/plugin-typescript/tests/`:

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

The `@contractkit/plugin-typescript` plugin handles all TypeScript output via sub-configs:

```json
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

Each sub-config is optional. `zod: true` makes `output.types` emit Zod schemas (via `generateContract`) instead of plain TypeScript interfaces. Path templates support `{filename}`, `{dir}`, `{area}`, `{subarea}`, and `{name}`.

SDK method names follow this priority: `sdk:` field → `name:` field (converted to camelCase) → inferred from HTTP method + path. The Python SDK plugin uses the same priority but converts to `snake_case`.

### TS SDK subclient grouping

`keys.area` and `keys.subarea` cluster operations on the generated SDK:

- `(area + subarea)` files emit a leaf `<Area><Subarea>Client` in `output.clients` (path can use `{subarea}`); the area's `<Area>Client` (in `<area>.client.ts`) wires it as `sdk.<area>.<subarea>`.
- `(area only)` files do **NOT** emit a standalone `*.client.ts`. Their methods are merged into the area's synthesized `<Area>Client` (emitted to `<area>.client.ts` next to the leaves). Surfaced as `sdk.<area>.<method>`.
- `(neither)` files keep the legacy flat shape: per-file `<Filename>Client` exposed as `sdk.<filename>`.

Every area gets its own `<area>.client.ts` file (path derived from the `output.clients` template via `computeSdkAreaClientOutPath` — `{filename}` and `{area}` resolve to the area name, `{subarea}` resolves to empty). The SDK aggregator (`sdk.ts`) just imports each `<Area>Client` and wires it onto the `Sdk` class — it no longer declares any client classes itself.

Multiple area-level files merge into one `<Area>Client`. Duplicate method names within that merge throw at codegen — disambiguate with `sdk:` or split into a subarea. See `generateAreaClient` and `generateSdkAggregator` in `packages/plugin-typescript/src/codegen-sdk.ts` for the codegen entry points.

The SDK emits a shared `sdk-options.ts` alongside the client files. It contains `SdkOptions`, `createSdkFetch`, `buildQueryString`, `parseJson<T>`, and bigint JSON helpers. Void operations (no response body) skip body consumption entirely.

The plugin interface is defined in `packages/contractkit/src/plugin.ts`. Hooks:

- `transform` — mutate the AST per file before validation
- `validate` — throw to fail compilation
- `validateExtension(value)` — validate the plugin's per-operation `pluginExtensions[name]` entry; return `{ errors?, warnings? }` (errors fail compilation)
- `generateTargets` — called once after all files are parsed; call `ctx.emitFile()` for each output
- `command` — register a CLI subcommand (`contractkit <name>`)

### Per-operation plugin extensions

The `plugins:` block on an operation accepts JSON-like values (string, number, boolean, null, object, array). Each entry's key maps to a plugin by `name`. Pipeline:

1. Parser builds `op.plugins: Record<string, PluginValue>` (raw AST — retained so prettier can round-trip).
2. CLI runs `resolvePluginExtensions` (`apps/cli/src/resolve-plugin-extensions.ts`, async) — walks each value tree and replaces strings starting with `file://` (resolved relative to the `.ck` file) or `http(s)://` (fetched via GET) with the corresponding payload. The transformed tree is stored at `op.pluginExtensions`. Missing files, network errors, and non-2xx HTTP responses warn and leave the URL string in place. Each unique HTTP URL is fetched at most once per run; when caching is enabled, successful responses are persisted via `CacheService.httpCache()` and reused across runs. `--force` (or `cache: false`) skips both caches.
3. CLI dispatches each `pluginExtensions[name]` entry to the plugin whose `name` matches; the plugin's `validateExtension` callback returns errors/warnings that the CLI emits on `op.loc.line`.
4. Plugins read `op.pluginExtensions[name]` (never `op.plugins`) at codegen time. Bruno expects `{ template?: string }` where `template` is a YAML fragment to deep-merge into the generated request — `validateBrunoExtension` enforces the shape.

Variable substitution (`{{name}}`) walks recursively into nested plugin values, so `file://{{bruno}}/foo.yml` works.

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

| Modifier                 | Effect                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `?` suffix on field name | Optional field                                                                                  |
| `readonly`               | Field excluded from Input schema                                                                |
| `writeonly`              | Field excluded from Read schema                                                                 |
| `deprecated`             | Marks field as deprecated                                                                       |
| `override`               | Required when redeclaring a field that conflicts across bases. See "Multi-base inheritance".    |
| `= value`                | Default value (string, number, boolean, or identifier)                                          |

Modifiers compose in any order on the source side (`override readonly`, `readonly override`, `deprecated override readonly`, etc.). The prettier printer emits them in canonical order: **override → deprecated → readonly|writeonly**. Conflicting visibility modifiers (`readonly` + `writeonly` on the same field) are a parse-time error.

### Multi-base inheritance

`contract C: A & B & C & D & { ... }` produces `model.bases = ['A', 'B', 'C', 'D']` (multi-base). Each base contributes its full **effective** field set (own fields plus its own bases', with own overrides applied) — diamond inheritance is deduplicated at resolution time.

`validate-inheritance.ts` runs after `validate-refs` and enforces:

- **Cross-base conflict requires `override`** — if two bases contribute a same-named field with non-identical shape, the subclass must redeclare with `override`. Identical contributions are silently deduplicated. The shape predicate `fieldsAreIdentical` compares type (deep), `optional`, `nullable`, `visibility`, `default`, `deprecated`; `description` and `loc` are ignored.
- **`override` must shadow** — using `override` on a field name not present in any base is an error.
- **Cycle detection** — `A: B`, `B: A` (or longer chains) emit `Inheritance cycle: ...` once per cycle and skip the conflict check for nodes in the cycle.

Codegen impact:

- **Zod**: `Test5 = A.extend(B.shape).extend(C.shape).extend(D.shape).extend({...inline})`. Last-wins is the runtime semantics; the inline block is appended last so overrides win.
- **Plain TS** (`codegen-plain-types.ts`): `interface Test5 extends A, B, C, D { ... }`. When fields are overridden, each base is wrapped in `Omit<Base, 'a' | 'b'>` (TypeScript's `Omit` tolerates omit keys that don't exist on the base, so we omit unconditionally — no per-base field-set lookup needed).
- **Python**: `class Test5(A, B, C, D): ...` with Pydantic v2 MRO handling override redeclarations.
- **OpenAPI**: `allOf: [{ $ref: A }, { $ref: B }, { $ref: C }, { $ref: D }, { ...inline }]`.
- **Markdown**: `Extends [\`A\`](#a), [\`B\`](#b), ...`
- **Bruno** uses `resolveModelFields` to flatten the chain with overrides applied; nothing user-visible changes.

`override` semantics are **replace, not patch** — the modifier replaces the full field declaration including visibility, defaults, optionality. Re-add them on the override line if you want to preserve them (`override readonly int = 0`).

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
- **Python SDK** emits a per-method `TypedDict` (e.g. `GetTransferHeaders`) at module top and changes the method return type to `tuple[T, GetTransferHeaders]` (or just the TypedDict for void). The base client gains `_fetch_with_headers`, which lowercases response-header keys for case-insensitive lookup.
- **Bruno** emits `isDefined` runtime assertions for each required response header on the asserted status code, and lists all declared headers in the request's `docs` block.
- **Markdown** renders a "Response headers" table.

Header values are always read as strings (TS uses `Headers.get(...) ?? undefined`, Python uses the lowercased response-header dict). Declaring a non-`string` type is allowed but no runtime parsing/coercion is generated.

### Options-level header globals

A file's `options` block can declare `request: { headers: {...} }` and `response: { headers: {...} }` to apply headers to every operation in the file. AST: `OpRootNode.requestHeaders?` / `responseHeaders?: OpResponseHeaderNode[]`. The merge happens in `apply-options-defaults.ts` — a normalization pass that runs after parsing (in the CLI between `parseCk` and decompose, NOT inside `parseCk` itself, so the prettier plugin sees the un-merged AST for round-trip formatting).

- **Request headers**: merged into every operation's request headers. Op-level header with the same name wins (override warning emitted). If the op declares `headers: none` (`OpOperationNode.requestHeadersOptOut`), the merge is skipped. If the op uses a referenced/compound type for headers, the merge is skipped with a warning.
- **Response headers**: merged into every status code on every operation, regardless of body presence or status class. Per-status `headers: none` (`OpResponseNode.headersOptOut`) skips the merge for that code. Per-status header with the same name wins.
- **Path-param collision**: a global request header that collides with a path parameter name on any route raises an error.

Asymmetry to know about: TS server `ctx.set()` emission and TS SDK return shape only honor headers on the **primary response** (the first response with a body, fallback to first response). OpenAPI and Markdown iterate every status code, so options-level response headers fully surface there. Treat global response headers as a **spec/docs feature** — runtime emission for non-primary statuses still requires inlining the header on that status.

### Variable substitution

`{{name}}` references inside any string in a `.ck` file are expanded at compile time. Lookup order:

1. The file's `options { keys: { ... } }` block (`root.meta`).
2. A workspace-wide fallback collected by the CLI from each plugin entry's `options.keys` in `contractkit.config.json`.

Behavior:

- Unknown variable → emits the literal string `undefined` and a warning (`Unknown variable '{{name}}'`).
- `\{{name}}` → literal `{{name}}` (the `\` escapes the substitution; no warning).
- Substitution applies to **every** string field in the AST except `root.meta` itself (keys are not recursively expanded).

The pass lives in `apply-variable-substitution.ts` and runs in the CLI between `parseCk` and `decomposeCk`, after `applyOptionsDefaults`. It does **not** run inside `parseCk` so the prettier plugin sees the un-substituted source form and can round-trip the file.

Plugin-config fallback example:

```json
"plugins": {
    "@contractkit/plugin-bruno": {
        "keys": { "bruno": "{{rootDir}}/apps/api/contracts/bruno" }
    }
}
```

Values inside plugin-config `keys` can reference the built-in variables `{{rootDir}}` and `{{configDir}}`, which the CLI substitutes at config load time with the resolved absolute paths. Unknown built-ins emit a `console.warn` and substitute `undefined`.

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
3. `apps/vscode-extension/syntaxes/ck.tmLanguage.json` — update the syntax-highlighting regex so the editor accepts the same characters as the parser. Re-run `pnpm run vscode:install` to reload locally.
4. `apps/prettier-plugin/src/print-*.ts` — update the formatter to round-trip the new syntax. Add a round-trip test in `apps/prettier-plugin/tests/print-ck.test.ts`.
5. `parser-ck.test.ts` — add a parser test
6. **All codegen plugins** — every plugin that consumes the affected AST shape needs its codegen and tests updated. Check each one explicitly, not just the TypeScript plugin:
   - `packages/plugin-typescript` (server, SDK, Zod, plain types)
   - `packages/plugin-python` (Pydantic + httpx client)
   - `packages/plugin-openapi` (OpenAPI 3.0 YAML)
   - `packages/plugin-markdown` (API reference)
   - `packages/plugin-bruno` (Bruno collections)
   - `packages/openapi-to-ck` (reverse direction — OpenAPI YAML → `.ck`)
7. `apps/cli` — update if file discovery, config schema, or cache fingerprinting is affected.
8. `README.md` — update language reference / examples if the surface syntax changed
9. `CLAUDE.md` — update as needed
10. Run `pnpm test` at the workspace root to confirm every package's tests pass before considering the change done.

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
