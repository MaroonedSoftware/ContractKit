# @contractkit/plugin-typescript

ContractKit plugin that generates TypeScript output from `.ck` contract files. Covers all server-side and client-side TypeScript needs: Koa routers, SDK clients, Zod schemas, and plain TypeScript interfaces.

## Installation

```bash
pnpm add @contractkit/plugin-typescript
```

## Configuration

Add the plugin to `contractkit.config.json`. Each sub-config is independent — include only what you need.

```json
{
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

Generates server router files from `operation` declarations and optionally type files from `contract` declarations.

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for output files |
| `framework` | `string` | `"koa"` | HTTP framework the routers target: `"koa"` or `"fastify"`. Also selects the `mcp.router.ts` flavour. |
| `zod` | `boolean` | `false` | Emit Zod schemas in `output.types` instead of plain interfaces |
| `output.routes` | `string` | — | Path template for router files |
| `output.types` | `string` | — | Path template for type/schema files |
| `servicePathTemplate` | `string` | — | Import path template for service implementations |
| `validateResponses` | `boolean` | `false` | Re-parse the service result against its response schema before writing `ctx.body`. Requires `zod: true`. |

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
| `target` | `"client" \| "server"` | `"client"` | Runtime the types describe. Affects scalars whose TypeScript type is runtime-specific: `binary` renders as `Buffer` for `server` and `Blob` for `client` |

The `server` and `sdk` sub-generators set `target` themselves (`server` and `client` respectively), so
their plain-type output already matches the runtime that consumes it.

`decimal` is the one scalar that renders the same for both targets — decimal.js `Decimal` — because
it has no output transform, so the wire view and the server view agree. That also means plain-type
output carries a real `import Decimal from 'decimal.js'`, and the scaffolded `package.json` adds
`decimal.js` as a dependency whenever a covered model uses the scalar.

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

### Router shape (from `operation`)

Each operation file generates one router, targeting the framework named by `framework`. On Koa a handler is `async ctx => {}` writing `ctx.status` / `ctx.type` / `ctx.body`; on Fastify it is `async (request, reply) => {}` reading `request.parsedBody` and returning `reply.send(...)`. Validation, service dispatch and the response shape are identical either way. Request bodies and path/query params are validated against the Zod schemas (when `zod: true`) or plain types. Handlers are expected to be exported from the service module specified by `servicePathTemplate`.

Responses are only type-annotated by default. With `validateResponses: true` (which requires `zod: true`) the service's return value is re-parsed against its declared response schema and the parsed value is written to `ctx.body`, so a service returning a shape the contract does not allow fails with a 500 instead of shipping it. See [docs/config.md](../../docs/config.md#validateresponses) for the caveats — notably that models using `format(input=…)`/`format(output=…)` are skipped.

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

- `SdkOptions` / `SdkFetch` / `SdkRequestInit` / `SdkError` / `createSdkFetch` — base client primitives. `SdkError<TBody>` exposes `status`, `statusText`, `body`, and `headers` (the raw `Headers` instance); each operation that declares a body on a thrown status also exports a matching `…ErrorBody` alias to narrow `body` to.
- `buildQueryString(query)` — serialises a query params object to `?key=value` or `''`
- `parseJson<T>(res)` — deserialises a `Response` body to `T`
- `readContentType(res)` — the response's mime with any `; charset=…` stripped, used when a status declares several content types
- `bigIntReplacer` / `bigIntReviver` — JSON replacer/reviver for `bigint` values

`SdkError` is raised for any response at or above 400 **except** the statuses an operation
declares as values. Those are passed per-call as `expectStatuses`, so a `304` produced by
conditional-GET middleware, or an error status the service returns deliberately, comes back as a
normal return value instead of a throw. See the response section of the root README for which
statuses fall into which set.

## Programmatic use

```typescript
import { createTypescriptPlugin } from '@contractkit/plugin-typescript';

const plugin = createTypescriptPlugin({
  server: {
    output: { routes: 'src/routes/{filename}.router.ts' },
    servicePathTemplate: '#services/{module}.service.js',
  },
});
```
