---
'@contractkit/plugin-typescript': patch
---

Koa routers now accept request bodies with a `+json` structured-suffix type such as `application/vnd.api+json` or `application/webhook+json`. The generated `bodyParserMiddleware` call passes `'+json'` for those types instead of `'json'`, which Koa matches against `application/json` alone and so answered such requests with a 415.
