# Configuration

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

## Top-level fields

| Field      | Type                | Description                                                                                                                                                     |
| ---------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`  | `string`            | Base directory for resolving relative paths. Supports `~` for `$HOME`. Default: `.`                                                                             |
| `cache`    | `boolean \| string` | Enable on-disk caching (build hashes + fetched HTTP responses). Pass a string to override the cache directory (default: `.contractkit/cache`). Default: `false` |
| `prettier` | `boolean`           | Format generated TypeScript files with your local prettier. Default: `false`                                                                                    |
| `patterns` | `string[]`          | Glob patterns for `.ck` files to compile, relative to `rootDir`                                                                                                 |
| `plugins`  | `object`            | Map of plugin package name → options. See plugins below.                                                                                                        |

## Built-in plugins

Each plugin is its own npm package and is loaded by listing it under `"plugins"`. The value of each entry is passed to the plugin as `ctx.options`.

| Package                          | Generates                                                          |
| -------------------------------- | ------------------------------------------------------------------ |
| `@contractkit/plugin-typescript` | Koa routers, TypeScript SDK clients, Zod schemas, plain TS types   |
| `@contractkit/plugin-openapi`    | OpenAPI 3.1 YAML                                                   |
| `@contractkit/plugin-markdown`   | Markdown API reference                                             |
| `@contractkit/plugin-docs`       | Mintlify documentation site (MDX pages, `docs.json`, OpenAPI spec) |
| `@contractkit/plugin-bruno`      | Bruno REST collection                                              |
| `@contractkit/plugin-python`     | Python SDK client (Pydantic v2 + httpx)                            |

### `@contractkit/plugin-typescript`

Has up to four optional sub-configs. Each is independent — include only the ones you need.

#### `server`

Generates Koa router files from `operation` declarations. Optionally also emits Zod schemas or plain TypeScript types from `contract` declarations (used for typing route handlers).

| Field                 | Type      | Description                                                                                                                |
| --------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------- |
| `baseDir`             | `string`  | Directory (relative to `rootDir`) where server files are written                                                           |
| `zod`                 | `boolean` | When true, `output.types` emits Zod schemas. When false/omitted, emits plain TypeScript interfaces.                        |
| `output.routes`       | `string`  | Path template for Koa router files. Default: `{filename}.router.ts`                                                        |
| `output.types`        | `string`  | Path template for type/schema files                                                                                        |
| `servicePathTemplate` | `string`  | Import path template for service implementations. Supports `{module}`.                                                     |
| `includeInternal`     | `boolean` | Whether to emit handlers for `internal` operations. Default: `true`.                                                       |
| `validateResponses`   | `boolean` | Re-parse the service result against its response schema before writing `ctx.body`. Requires `zod: true`. Default: `false`. |

##### `validateResponses`

Generated handlers always validate what comes _in_ — params, query, headers and request body all go
through `parseAndValidate`. `validateResponses` extends that to what goes _out_: the value the
service returns is re-parsed against the response schema declared in the contract, and the parsed
value is what reaches `ctx.body`.

```ts
const result: User = await service.getById(id);

ctx.status = 200;
ctx.type = 'application/json';
ctx.body = await parseAndValidate(result, User, 500);
```

It is opt-in, and off by default, for one reason worth understanding before you turn it on.
TypeScript only rejects excess properties on object _literals_, so a service that returns a database
row carrying columns the contract never declared satisfies `const result: User` today and quietly
ships them. Under the default `strict` object mode that becomes a 500 on every request, so expect
the first run with the flag on to surface real contract drift. Switching a model to `mode(strip)`
makes the extra keys disappear from the wire instead — the parsed value is what is written, so
stripping now has a visible effect on responses.

Requirements and limits:

- **`zod: true` is required.** Without it `output.types` emits plain interfaces, which are types with
  no runtime schema value to validate against. Setting `validateResponses` without it fails the
  build with an explicit error rather than emitting code that cannot compile.
- **`@maroonedsoftware/zod` 0.6.1 or later**, for the `statusCode` argument and its handling of it.
- **Failures are 500s, and the detail is log-only.** A service returning a shape its own contract
  rejects is a server fault, not a client one. At 5xx `parseAndValidate` puts the field-level map on
  the error's `internalDetails` rather than `details`, so `errorMiddleware` keeps it out of the
  response body — which does mean you need the app's error logging wired up to see _which_ field
  was wrong.
- **Bodies that reference a `format(input=…)` or `format(output=…)` model are skipped.** Those
  schemas transform keys between the wire casing and the developer-facing casing, and the service
  already returns the post-transform shape, so re-parsing it through the same schema would fail on
  every key. The skip follows model references transitively.
- **A status declaring several content types with _different_ body shapes is skipped.** When the
  shapes match (`image/png` and `image/jpeg` both `binary`) one schema covers them and validation
  applies as normal.

#### `sdk`

Generates a typed TypeScript HTTP client. Each operation file becomes a client class; an aggregator class plus a shared `sdk-options.ts` runtime helper file are emitted automatically. Operations marked `internal` are excluded from the SDK by default — set `includeInternal: true` for an internal-use SDK.

| Field             | Type      | Description                                                                                                                                                |
| ----------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory (relative to `rootDir`) where SDK files are written                                                                                              |
| `name`            | `string`  | Used for the aggregator SDK class name (e.g. `"myapp"` → `MyappSdk`)                                                                                       |
| `zod`             | `boolean` | When true, `output.types` emits Zod schemas. When false/omitted, emits plain TypeScript interfaces.                                                        |
| `output.sdk`      | `string`  | Path template for the SDK aggregator file. Supports `{name}`. Default: `sdk.ts`                                                                            |
| `output.types`    | `string`  | Path template for SDK type files                                                                                                                           |
| `output.clients`  | `string`  | Path template for client class files                                                                                                                       |
| `includeInternal` | `boolean` | Whether to emit SDK methods for `internal` operations. Default: `false`.                                                                                   |
| `scaffold`        | `boolean` | Emit a starter `package.json` and `tsconfig.json` at `baseDir` so the SDK is a buildable package. Opt-in and **write-once** — see below. Default: `false`. |

When `scaffold: true`, the SDK output becomes a standalone, buildable package: a `package.json` (with a `build` script, `exports`, and dependency ranges) and a self-contained `tsconfig.json` are written at `baseDir`. Dependencies are derived from the contracts — `zod` is added when `zod: true`, and `luxon` (plus `@types/luxon`) when any surfaced model uses a `date`/`time`/`datetime`/`interval` scalar. These files are **written only when absent**: they are never overwritten on later builds and never removed by orphan cleanup, so once created they are yours to edit. Disabling `scaffold` later leaves your files untouched.

#### `zod` and `types`

Standalone generators that emit one Zod (or plain TS) file per `.ck` source file. Use these when you don't need a router or SDK — just schemas/types.

| Field     | Type     | Description                                                                                            |
| --------- | -------- | ------------------------------------------------------------------------------------------------------ |
| `baseDir` | `string` | Directory (relative to `rootDir`) where files are written                                              |
| `output`  | `string` | Path template. Default: `{filename}.schema.ts` (zod) or `{filename}.types.ts` (types) alongside source |

All path templates support `{filename}`, `{dir}`, `{area}`, and (for `output.sdk`) `{name}`. `{area}` resolves to the `area` value declared in the source file's `options { keys: { area: ... } }` block.

### `@contractkit/plugin-openapi`

| Field             | Type      | Description                                                            |
| ----------------- | --------- | ---------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory for the output file                                          |
| `output`          | `string`  | Output filename. Default: `openapi.yaml`                               |
| `info`            | `object`  | OpenAPI `info` block (`title`, `version`, `description`)               |
| `servers`         | `array`   | List of `{ url, description }` server entries                          |
| `security`        | `array`   | Global OpenAPI security requirement                                    |
| `securitySchemes` | `object`  | Map of scheme name → OpenAPI security scheme (e.g. `{ type, scheme }`) |
| `includeInternal` | `boolean` | Whether to document `internal` operations. Default: `false`.           |

Only types referenced by emitted operations are included.

### `@contractkit/plugin-markdown`

| Field             | Type      | Description                                                |
| ----------------- | --------- | ---------------------------------------------------------- |
| `baseDir`         | `string`  | Directory for the output file                              |
| `output`          | `string`  | Output filename. Default: `api-reference.md`               |
| `includeInternal` | `boolean` | Whether to render `internal` operations. Default: `false`. |

Unreachable types are excluded.

### `@contractkit/plugin-docs`

Generates a documentation site from the contracts. `mintlify` is the only `target` today: it emits
an OpenAPI spec, one MDX page per endpoint and per documented model, a `docs.json`, and a starter
`index.mdx`. Mintlify renders parameters, schemas and the interactive playground from the spec, so
the pages themselves are frontmatter only.

| Field             | Type              | Description                                                                                                                                |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `target`          | `string`          | Documentation platform. Only `mintlify` is supported. Default: `mintlify`                                                                  |
| `baseDir`         | `string`          | Docs root, relative to `rootDir`. Default: `docs`                                                                                          |
| `apiDir`          | `string`          | Endpoint page directory under `baseDir`. Default: `api-reference`                                                                          |
| `modelsDir`       | `string`          | Model page directory under `baseDir`. Default: `<apiDir>/models`                                                                           |
| `openapi`         | `object`          | Spec settings — takes `output`, `info`, `servers`, `security` and `securitySchemes` as plugin-openapi does. Default output: `openapi.yaml` |
| `tab`             | `string \| false` | Generated tab title. `false` puts the groups under `navigation.groups` instead. Default: `API Reference`                                   |
| `modelPages`      | `boolean`         | Emit a page per documented model. Default: `true`                                                                                          |
| `includeInternal` | `boolean`         | Whether to document `internal` operations. Default: `false`                                                                                |
| `docs`            | `object`          | Merged over the generated `docs.json` — `name`, `theme`, `colors`, `logo`, extra navigation tabs or groups                                 |

`docs.json` is regenerated on every build so navigation cannot drift from the contracts. Anything
you want to keep goes in `docs`: its keys override the generated defaults, and under `navigation`
your `tabs` (or `groups`) are kept with the generated API reference appended after them. Other
`navigation` keys such as `global` pass through untouched.

Endpoint pages are grouped by the source file's `area`, and page titles follow `name:`, then the
description, then the service method, then the HTTP verb and path. `index.mdx` is written only when
absent, so it is yours to edit; every other file is regenerated.

### `@contractkit/plugin-bruno`

| Field             | Type      | Description                                                                                       |
| ----------------- | --------- | ------------------------------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Directory for the output collection                                                               |
| `output`          | `string`  | Output directory name. Default: `bruno-collection`                                                |
| `collectionName`  | `string`  | Bruno collection name. Default: the rootDir basename                                              |
| `auth`            | `object`  | `{ defaultScheme, schemes }` — schemes use the same shape as OpenAPI security schemes plus `hmac` |
| `includeInternal` | `boolean` | Whether to generate request files for `internal` operations. Default: `true`.                     |
| `environments`    | `object`  | Map of environment name → variables. Each entry produces a `environments/<name>.yml` file.        |

Regenerates the output directory cleanly on each run.

### `@contractkit/plugin-python`

| Field             | Type      | Description                                                                 |
| ----------------- | --------- | --------------------------------------------------------------------------- |
| `baseDir`         | `string`  | Output directory relative to `rootDir`. Default: `python-sdk`               |
| `packageName`     | `string`  | Used in the aggregator class name. Default: `Sdk`                           |
| `includeInternal` | `boolean` | Whether to emit client methods for `internal` operations. Default: `false`. |

Emits one Pydantic v2 module per contract file and one httpx client per operation file. Method names follow the same priority as the TS SDK (`sdk:` → `name:` → derived from HTTP verb + path), converted to `snake_case`.

## Writing your own plugin

Plugins implement the `ContractKitPlugin` interface from `@contractkit/core`. Hooks: `transform` (mutate AST per file), `validate` (throw to fail compilation), `generateTargets` (emit output files), and `command` (register a CLI subcommand). See `packages/contractkit/src/plugin.ts`.

---
