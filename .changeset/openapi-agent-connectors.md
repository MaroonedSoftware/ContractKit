---
'@contractkit/plugin-docs': minor
---

Make the OpenAPI target fit for AI agents building connectors from it. `operationSecurity: { read, write }` gives every authenticated operation the security (and so the OAuth scopes) for a read or a write, chosen by its MCP `readOnlyHint`. `tags` tags each operation with its file's `area`. `omitMcpExcluded` leaves out operations marked `mcp: exclude`. `mcpAnnotations` adds the four MCP hints as `x-mcp-annotations`. A `.json` output is written as JSON, and `securitySchemes` now types OAuth 2.0 `flows`, `openIdConnectUrl` and `description`.
