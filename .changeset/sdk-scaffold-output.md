---
'@contractkit/plugin-typescript': minor
'@contractkit/core': minor
'@contractkit/cli': patch
---

Add opt-in `sdk.scaffold` to the TypeScript plugin, which emits a starter `package.json` and `tsconfig.json` at the SDK `baseDir` so generated output is a buildable, publishable package. Dependencies are derived from the contracts (`zod` when `zod: true`; `luxon`/`@types/luxon` when a date/time scalar is used). Scaffold files are write-once: a new `ctx.emitFile(path, content, { ifAbsent: true })` option writes them only when absent and never overwrites or orphan-deletes them, so disabling `scaffold` or editing the files later is always safe.
