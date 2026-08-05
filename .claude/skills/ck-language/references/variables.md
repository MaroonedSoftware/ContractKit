# Variable substitution

`{{name}}` references inside any string in a `.ck` file are expanded at compile time.
Lookup order:

1. The file's `options { keys: { ... } }` block (`root.meta`).
2. A workspace-wide fallback the CLI collects from each plugin entry's `options.keys` in
   `contractkit.config.json`.

Behavior:

- Unknown variable → emits the literal string `undefined` plus a warning
  (`Unknown variable '{{name}}'`).
- `\{{name}}` → literal `{{name}}`; the `\` escapes the substitution, no warning.
- Substitution applies to **every** string field in the AST except `root.meta` itself
  (keys are not recursively expanded).
- It walks recursively into nested plugin-extension values, so `file://{{bruno}}/foo.yml`
  works.

The pass lives in `apply-variable-substitution.ts` and runs in the CLI between `parseCk`
and `decomposeCk`, after `applyOptionsDefaults`. It does **not** run inside `parseCk`, so
the prettier plugin sees the un-substituted source and can round-trip the file.

## Plugin-config fallback

```json
"plugins": {
    "@contractkit/plugin-bruno": {
        "keys": { "bruno": "{{rootDir}}/apps/api/contracts/bruno" }
    }
}
```

Values inside plugin-config `keys` can reference the built-ins `{{rootDir}}` and
`{{configDir}}`, which the CLI substitutes at config-load time with resolved absolute
paths. Unknown built-ins emit a `console.warn` and substitute `undefined`.
