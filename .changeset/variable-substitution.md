---
'@contractkit/core': minor
'@contractkit/cli': minor
---

Add `{{var}}` variable substitution in `.ck` files.

Variables declared in a file's `options { keys: { ... } }` block can now be referenced from any string in the file as `{{name}}`. The CLI also collects a workspace-wide fallback map from each plugin entry's `options.keys` in `contractkit.config.json`, so an author can define a key once and use it across every `.ck` file.

- `{{name}}` → resolved from `options.keys` first, then the plugin-config fallback. Unknown variables emit the literal string `undefined` and a warning (`Unknown variable '{{name}}'`).
- `\{{name}}` → escapes the substitution; the literal characters `{{name}}` are emitted with no warning.

Substitution runs as a post-parse normalization pass (after `applyOptionsDefaults`), so the prettier plugin still round-trips the source form.

Example:

```
options {
    keys: { bruno: "../../bruno" }
}

operation /auth/token: {
    post: {
        plugins: { bruno: "{{bruno}}/authentication/request.token.yml" }
        response: { 201: { application/json: AuthenticationToken } }
    }
}
```
