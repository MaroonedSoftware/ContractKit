# @maroonedsoftware/contractkit-plugin-bruno

ContractKit plugin that generates a [Bruno](https://www.usebruno.com/) REST API collection from `.ck` operation files. The output is a ready-to-open OpenCollection directory.

## Installation

```bash
pnpm add @maroonedsoftware/contractkit-plugin-bruno
```

## Configuration

```json
{
  "plugins": {
    "@maroonedsoftware/contractkit-plugin-bruno": {
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

## Programmatic use

```typescript
import { createBrunoPlugin } from '@maroonedsoftware/contractkit-plugin-bruno';

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
