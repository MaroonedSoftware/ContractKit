---
'@contractkit/plugin-typescript': minor
---

Stop emitting unused imports in generated Koa routers. `bodyParserMiddleware` was imported unconditionally even when no operation declared a request body, and `MultipartBody` was imported whenever any body was multipart — including when the multipart body is structurally equal to its sibling MIME types and the handler collapses to a single `parseAndValidate` call that never references it. `requirePolicy`, `requireSignature` and `parseAndValidate` could also go unused when `includeInternal: false` skipped the only handlers that needed them. Each unused import trips `noUnusedLocals` and lint in the consuming project.

Imports are now derived from the generated body — a symbol is emitted only if it actually appears in the output — rather than from predicates over the AST that had to be kept in step by hand.
