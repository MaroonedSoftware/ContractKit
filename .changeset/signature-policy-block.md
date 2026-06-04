---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
'@contractkit/prettier-plugin': minor
'@contractkit/openapi-to-ck': minor
'@contractkit/plugin-markdown': patch
'@contractkit/explorer-ui': patch
---

Add a block form to the operation `signature:` key. Alongside the existing bare form (`signature: KEY`), you can now write `signature: { options: KEY, policy: name }` to attach a signature-scoped policy. The policy is passed through to the generated `requireSignature(KEY, { policy: name })` middleware and surfaces in OpenAPI-to-`.ck` output, Markdown docs, and the explorer UI. The bare form is unchanged and remains shorthand for a block with only `options:`.
