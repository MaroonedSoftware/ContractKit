# @contractkit/contractkit-plugin-openapi

ContractKit plugin that generates an OpenAPI 3.0 YAML specification from `.ck` contract and operation files.

## Installation

```bash
pnpm add @contractkit/contractkit-plugin-openapi
```

## Configuration

```json
{
  "plugins": {
    "@contractkit/contractkit-plugin-openapi": {
      "output": "openapi.yaml",
      "info": {
        "title": "Acme API",
        "version": "1.0.0",
        "description": "Public API for Acme services"
      },
      "servers": [
        { "url": "https://api.acme.com", "description": "Production" },
        { "url": "https://api.staging.acme.com", "description": "Staging" }
      ],
      "security": [{ "bearerAuth": [] }],
      "securitySchemes": {
        "bearerAuth": {
          "type": "http",
          "scheme": "bearer",
          "bearerFormat": "JWT"
        }
      }
    }
  }
}
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `baseDir` | `string` | `rootDir` | Base directory for the output file |
| `output` | `string` | `"openapi.yaml"` | Output file path |
| `info.title` | `string` | — | API title in the `info` block |
| `info.version` | `string` | — | API version in the `info` block |
| `info.description` | `string` | — | API description in the `info` block |
| `servers` | `array` | — | List of server objects (`url`, optional `description`) |
| `security` | `array` | — | Global security requirements (e.g. `[{ "bearerAuth": [] }]`) |
| `securitySchemes` | `object` | — | Security scheme definitions added to `components.securitySchemes` |

### Security scheme types

| `type` | Required fields | Description |
|---|---|---|
| `"http"` | `scheme` (`"bearer"` or `"basic"`), optional `bearerFormat` | HTTP auth (Bearer JWT, Basic, etc.) |
| `"apiKey"` | `name`, `in` (`"header"` or `"query"`) | API key passed in a header or query param |
| `"oauth2"` | — | OAuth 2.0 |
| `"openIdConnect"` | — | OpenID Connect |

## Output

The plugin writes a single YAML file. All `contract` declarations become entries in `components/schemas`. All `operation` declarations become paths with their HTTP verbs, request bodies, parameters, and response schemas.

Operations marked `internal` are omitted from the generated spec by default. Set `includeInternal: true` in the plugin config to include them (e.g. for an internal-use API spec).

## Programmatic use

```typescript
import { createOpenApiPlugin } from '@contractkit/contractkit-plugin-openapi';

const plugin = createOpenApiPlugin({
  output: 'dist/openapi.yaml',
  info: { title: 'My API', version: '2.0.0' },
  servers: [{ url: 'https://api.example.com' }],
});
```
