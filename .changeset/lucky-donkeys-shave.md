---
'@contractkit/plugin-openapi': patch
---

Export `buildOpenApiDocument`, which returns the OpenAPI document as a plain object before YAML
serialization. `generateOpenApi` is now that plus `toYaml`. Lets other plugins consume the
document structurally instead of parsing the YAML back.
