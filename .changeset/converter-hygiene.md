---
'@contractkit/openapi-to-ck': patch
---

Fix tag splitting, schema-name sanitization, and stale docs

- A model reached only from a `params`, `query` or `headers` block was filed under `shared.ck`
  instead of its own tag's file. `collectParamSourceRefs` was written against the shape
  `ParamSource` had before it became a tagged union, so only the `ref` case still worked — and
  only by coincidence, since it happens to look like a model reference.
- A schema whose name starts with a digit (`3DModel`) produced an identifier the parser rejects.
  It is now prefixed with `_`.
- `@scalar/openapi-parser` has been removed from the dependencies. It was never imported; the
  normalization is hand-written, despite a comment claiming otherwise.
- The README documented an `openapi-to-ck --input …` command that does not exist. The command is
  `import-openapi <spec-path>`, and the docs now cover `--no-comments`, `--error-responses`, and
  what the converter warns about rather than dropping silently.
