---
'@contractkit/plugin-typescript': patch
---

Generated Koa route handlers now use `async ctx => {` instead of `async (ctx, next) => {`. The `next` argument was never referenced in the emitted body and tripped no-unused-vars lint rules in consuming projects.
