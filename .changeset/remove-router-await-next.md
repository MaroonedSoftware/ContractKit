---
'@contractkit/plugin-typescript': patch
---

Stop emitting `await next()` at the end of generated Koa route handlers — route handlers are the terminus of the middleware chain.
