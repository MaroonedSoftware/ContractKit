---
'contractkit-vscode-extension': patch
---

Fix two unhandled cases in the language server and preview panel, and start typechecking the extension in CI.

`ItemSelection` gained a `file` variant that `preview-panel.ts` never handled, so opening a preview for a file produced an `undefined` panel key (breaking the reuse-existing-panel lookup) and an `undefined` tab title. Hover rendered a `discriminated(by=..., A | B)` field as `undefined`, because `formatType` had no `discriminatedUnion` case.

Both were type errors the compiler already knew about: the extension's `build:ci` ran ESLint and esbuild but never `tsc`, so nothing caught them. The package now has a `typecheck` script wired into `build:ci`. The webview gets its own `tsconfig.json` with the DOM lib — mirroring the separate browser bundle esbuild already produces — so the client and server code stays honest about running under Node instead of loosening `lib` for everything.

Also adds highlighting for options-level `request:`/`response:` header blocks, which parsed correctly but rendered unhighlighted.
