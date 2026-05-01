# @contractkit/contractkit-plugin-bruno

ContractKit plugin that generates a [Bruno](https://www.usebruno.com/) REST API collection from `.ck` operation files. The output is a ready-to-open OpenCollection directory.

## Installation

```bash
pnpm add @contractkit/contractkit-plugin-bruno
```

## Configuration

```json
{
  "plugins": {
    "@contractkit/contractkit-plugin-bruno": {
      "output": "bruno-collection",
      "collectionName": "Acme API",
      "auth": {
        "defaultScheme": "bearerAuth",
        "schemes": {
          "bearerAuth": {
            "type": "http",
            "scheme": "bearer"
          }
        }
      }
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for the output |
| `output` | `string` | `"bruno-collection"` | Output directory name |
| `collectionName` | `string` | basename of `rootDir` | Collection name shown in Bruno |
| `randomExamples` | `boolean` | `true` | Use Bruno faker templates (`{{$randomUUID}}`, `{{$randomEmail}}`, etc.) for compatible scalar fields so each send produces fresh data. Set to `false` for stable, deterministic placeholders. |
| `includeInternal` | `boolean` | `true` | Include operations marked `internal`. Set to `false` to omit them from the collection. |
| `auth.defaultScheme` | `string` | — | Key from `auth.schemes` to apply by default |
| `auth.schemes` | `object` | — | Map of scheme name → security scheme definition |

### Auth scheme types

| `type` | Required fields | Description |
|---|---|---|
| `"http"` with `scheme: "bearer"` | — | Bearer token auth |
| `"http"` with `scheme: "basic"` | — | HTTP Basic auth |
| `"apiKey"` | `name`, `in` (`"header"` or `"query"`) | API key in a header or query param |

## Output structure

```
bruno-collection/
├── bruno.json             # Collection manifest
├── environments/
│   └── Local.bru          # Default environment with base URL variable
└── <area>/
    └── <operation>.bru    # One request file per HTTP verb per operation
```

The output directory is fully replaced on each run — stale request files from removed operations are automatically cleaned up.

## Per-operation overrides

Add a `plugins` block to any operation in a `.ck` file to deep-merge a YAML file into the generated request:

```
post: {
    plugins: {
        bruno: "overrides/auth-token.yml"
    }
    response: { 200: AuthResponse }
}
```

The file path is relative to the `.ck` source file. Its content is deep-merged into the generated request YAML — objects recurse, arrays replace entirely:

```yaml
# overrides/auth-token.yml
runtime:
  script:
    req: |
      bru.setVar("token", bru.getEnvVar("adminToken"));
```

Authoring tip: combine per-operation `plugins.bruno` paths with `{{var}}` substitution to factor out a shared override directory:

```
options {
    keys: { bruno: "../../bruno-overrides" }
}

operation /payments/{id}: {
    get: {
        plugins: { bruno: "{{bruno}}/payments/get-payment.yml" }
        response: { 200: { application/json: Payment } }
    }
}
```

The `{{bruno}}` reference can also be supplied workspace-wide via the plugin's `keys` config in `contractkit.config.json`.

## Programmatic use

```typescript
import { createBrunoPlugin } from '@contractkit/contractkit-plugin-bruno';

const plugin = createBrunoPlugin({
  output: 'bruno-collection',
  collectionName: 'My API',
  auth: {
    defaultScheme: 'bearerAuth',
    schemes: {
      bearerAuth: { type: 'http', scheme: 'bearer' },
    },
  },
});
```
