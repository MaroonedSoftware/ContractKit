---
'@contractkit/plugin-typescript': patch
---

The generated router now finds a request header declared with a name that is not lowercase.

Node lowercases every incoming header name, so `ctx.headers` (Koa) and `request.headers` (Fastify) hold `xtenant`, never `xTenant`. The router validated that object against a schema keyed by the declared name, so a required `xTenant` was always missing and the request failed whatever the client sent. This hit `headers: Tenant` with `contract Tenant: { xTenant: string }` and an inline `headers: { xTenant: string }` block alike; only lowercase or hyphenated names such as `x-tenant` worked.

Each declared name that is not lowercase is now read from its lowercase key before validation, `parseAndValidate({ ...ctx.headers, xTenant: ctx.headers['xtenant'] }, Tenant.strip())`, and the service receives it under the declared name. This covers inline blocks, models (their bases included) and models inside an intersection. A block whose names are all lowercase is generated exactly as before.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `6`, and a router's cache fingerprint now also covers the fields of a model its `headers:` references, so renaming such a field in another `.ck` file regenerates the router.
