---
'@contractkit/plugin-bruno': minor
---

Add `environments` config for the Bruno plugin.

Provide a map of environment name → variables in the plugin config and the codegen will emit one `environments/<name>.yml` per entry. Useful for shipping multiple Bruno environments (local, staging, etc.) alongside the generated collection.

```json
"@contractkit/plugin-bruno": {
    "environments": {
        "local": {
            "baseUrl": "http://localhost:3000",
            "token": ""
        }
    }
}
```

When `environments` is omitted, the default `environments/local.yml` is emitted (existing behavior). When provided, it replaces the default — include auth variables (e.g. `token`) explicitly if you need them. Also fixes a small omission in `createBrunoPlugin`: `includeInternal` is now forwarded to the codegen, matching the default plugin export.
