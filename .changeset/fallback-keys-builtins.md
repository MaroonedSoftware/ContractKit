---
'@contractkit/cli': minor
---

Allow `{{rootDir}}` and `{{configDir}}` inside plugin-config `keys` values.

Values inside a plugin's `keys: { ... }` block in `contractkit.config.json` can now reference two built-in variables — `{{rootDir}}` and `{{configDir}}` — which the CLI substitutes at config load time with the resolved absolute paths. Useful when a plugin needs to point at an absolute path relative to the project root:

```json
"@contractkit/plugin-bruno": {
    "keys": { "bruno": "{{rootDir}}/apps/api/contracts/bruno" }
}
```

Unknown built-ins emit a warning and substitute the literal string `undefined`. The `\{{name}}` escape works the same way it does inside `.ck` files.
