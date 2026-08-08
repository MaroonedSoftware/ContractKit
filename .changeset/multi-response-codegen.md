---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
'@contractkit/plugin-python': minor
'@contractkit/plugin-openapi': minor
'@contractkit/plugin-markdown': minor
'@contractkit/openapi-to-ck': minor
'@contractkit/explorer-ui': minor
'@contractkit/prettier-plugin': minor
---

Let an operation emit more than one status, and a status serve more than one content type.

A status code could previously declare only one mime — the parser warned `Duplicate response body` and dropped the rest — and the generated router pinned both `ctx.status` and `ctx.type` to whichever response happened to be listed first with a body. An endpoint serving several formats had to declare one lying mime and let browsers sniff, and a service had no way to say which status it produced.

A status now holds every declared `mime: Type` line (`OpResponseNode.bodies`). When there is more than one, the service picks at runtime and the router sets `ctx.type` from the returned `contentType`. When an operation produces more than one status, the service returns a union discriminated on `status` and the handler switches on it, so each status writes only its own headers, mime and body. Both SDKs mirror the router: the TypeScript and Python clients return a matching union, report which mime came back, and pass the non-2xx statuses they expect to the shared fetch so a declared `304` no longer surfaces as an error. `SdkError` now takes a body type parameter, and each operation exports a `…ErrorBody` alias for the statuses that stay on the throw path.

Which statuses the service produces is derived from the declaration: **a status is emitted if it has a block, or is 2xx.** An empty block (`304: {}`) says the service returns that status carrying nothing; a bare `304:` says it is documented and something else produces it. `404(documented): { … }` is the one modifier, forcing a block-carrying status back out.

Two long-standing bugs in the same area go with it. The formatter deleted any comment written inside a `response` block — above a status code, above a mime line, above a `headers:` block, or before a closing brace — so `pnpm format` silently threw away the notes explaining why a contract looks the way it does; all four positions now round-trip. And the generated router declared a `_ZodBinary` helper for a binary *response* body, which is a plain `Buffer` annotation with no schema behind it, leaving an unused const that tripped `noUnusedLocals` downstream; helpers are now chosen from the code that was actually generated, the same way imports already were.

**Breaking:** a contract that declares a body on an error status — `404: { application/json: Problem }` alongside a `200` — now returns it from the service instead of throwing, and the SDK return type becomes a union. Add `(documented)` to that status to keep the previous behaviour. Contracts whose error statuses are bodyless (`400:`, `404:`) are unaffected. `OpResponseNode.contentType`/`bodyType` are replaced by `bodies`; read that instead.
