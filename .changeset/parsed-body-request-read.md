---
'@contractkit/plugin-typescript': minor
---

Generated Koa routers now read the incoming request body from `ctx.parsedBody` instead of `ctx.body`, matching serverkit's refactor. The response body is still assigned via `ctx.body`.
