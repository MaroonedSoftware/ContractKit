# @contractkit/contractkit-plugin-typescript

ContractKit plugin that generates TypeScript output from `.ck` contract files. Covers all server-side and client-side TypeScript needs: Koa routers, SDK clients, Zod schemas, and plain TypeScript interfaces.

## Installation

```bash
pnpm add @contractkit/contractkit-plugin-typescript
```

## Configuration

Add the plugin to `contractkit.config.json`. Each sub-config is independent — include only what you need.

```json
{
  "plugins": {
    "@contractkit/contractkit-plugin-typescript": {
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
        "name": "acme",
        "zod": true,
        "output": {
          "sdk": "src/{name}.sdk.ts",
          "types": "src/{area}/types/{filename}.ts",
          "clients": "src/{area}/{filename}.client.ts"
        }
      },
      "zod": {
        "baseDir": "packages/schemas/",
        "output": "{filename}.schema.ts"
      },
      "types": {
        "baseDir": "packages/types/",
        "output": "{filename}.types.ts"
      }
    }
  }
}
```

## Sub-configs

### `server`

Generates Koa router files from `operation` declarations and optionally type files from `contract` declarations.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for output files |
| `zod` | `boolean` | `false` | Emit Zod schemas in `output.types` instead of plain interfaces |
| `output.routes` | `string` | — | Path template for router files |
| `output.types` | `string` | — | Path template for type/schema files |
| `servicePathTemplate` | `string` | — | Import path template for service implementations |

Each generated router imports handler implementations from a service module. The `servicePathTemplate` controls where that import points. Template variables: `{module}`.

### `sdk`

Generates a typed TypeScript SDK client from `operation` declarations. Produces individual client files per operation file plus an aggregator SDK class.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for output files |
| `name` | `string` | `"sdk"` | SDK class name (e.g. `"acme"` → `AcmeSdk`) |
| `zod` | `boolean` | `false` | Emit Zod schemas in `output.types` instead of plain interfaces |
| `output.sdk` | `string` | — | Path template for the aggregator SDK file |
| `output.types` | `string` | — | Path template for type/schema files |
| `output.clients` | `string` | — | Path template for individual client files |

### `zod`

Generates standalone Zod schema files from `contract` declarations only. Use this when you want schemas without any router or SDK output.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for output files |
| `output` | `string` | `"{filename}.schema.ts"` | Path template for schema files |

### `types`

Generates plain TypeScript interface/type files from `contract` declarations. No Zod runtime dependency.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for output files |
| `output` | `string` | `"{filename}.types.ts"` | Path template for type files |

## Path templates

Output paths support the following variables:

| Variable | Value |
|---|---|
| `{filename}` | Base name of the `.ck` source file (without extension) |
| `{dir}` | Relative directory of the `.ck` source file |
| `{area}` | Value of the `area` key from the `options` block |
| `{subarea}` | Value of the `subarea` key from the `options` block |
| `{name}` | The `name` option from the SDK sub-config |

## What gets generated

### Zod schema shape (from `contract`)

Contracts with `readonly` or `writeonly` fields generate up to three schemas:

- **`ModelBase`** — all fields including writeonly (only when writeonly fields exist)
- **`Model`** — read schema; no writeonly fields; extends `ModelBase` when it exists
- **`ModelInput`** — input schema; no readonly fields (only when readonly/writeonly fields exist)

Contracts without visibility modifiers generate a single `Model` schema.

### Koa router shape (from `operation`)

Each operation file generates one Koa router. Request bodies and path/query params are validated against the Zod schemas (when `zod: true`) or plain types. Handlers are expected to be exported from the service module specified by `servicePathTemplate`.

### SDK client shape (from `operation`)

Operation files cluster on the SDK based on `keys.area` and `keys.subarea` (set in each file's `options { keys: { ... } }` block):

| File metadata | Generated layout |
| --- | --- |
| `area: identity, subarea: invitations` | leaf `IdentityInvitationsClient` emitted as `<output.clients>` (path can use `{subarea}`); aggregator wires it as `sdk.identity.invitations` |
| `area: identity` (no subarea) | methods inlined directly on `IdentityClient` (no standalone `*.client.ts`); exposed as `sdk.identity.<method>` |
| neither | flat `<Filename>Client` exposed as `sdk.<filename>` (legacy behavior) |

Multiple files mapping to the same `(area, subarea)` are merged into one leaf class. Multiple area-level files merge into a single `<Area>Client`; duplicate method names across them throw at codegen — disambiguate with `sdk:` or move one into a subarea.

Method names follow this priority:

1. `sdk:` field on the HTTP verb declaration — used as-is (e.g. `sdk: getUser` → `getUser`)
2. `name:` field — converted to camelCase (e.g. `name: "Get User"` → `getUser`)
3. Inferred from the HTTP method and path (e.g. `GET /users/{id}` → `getUsersById`)

A shared `sdk-options.ts` file is emitted alongside the clients. It exports:

- `SdkOptions` / `SdkFetch` / `SdkError` / `createSdkFetch` — base client primitives
- `buildQueryString(query)` — serialises a query params object to `?key=value` or `''`
- `parseJson<T>(res)` — deserialises a `Response` body to `T`
- `bigIntReplacer` / `bigIntReviver` — JSON replacer/reviver for `bigint` values

## Programmatic use

```typescript
import { createTypescriptPlugin } from '@contractkit/contractkit-plugin-typescript';

const plugin = createTypescriptPlugin({
  server: {
    output: { routes: 'src/routes/{filename}.router.ts' },
    servicePathTemplate: '#services/{module}.service.js',
  },
});
```
