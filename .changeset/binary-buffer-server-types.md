---
'@contractkit/plugin-typescript': minor
---

Fix scalar response bodies in generated Koa routers, which emitted the `.ck` scalar name verbatim as a TypeScript type (`const result: binary`). Only `string`, `number`, `boolean`, `bigint`, `null` and `unknown` compiled by coincidence; `binary`, `int`, `uuid`, `datetime` and friends produced invalid code. Scalars now render as the type the handler actually receives: `binary` → `Buffer`, `int` → `number`, `datetime` → luxon `DateTime`, `interval` → `string`, `json` → `_JsonValue`.

Generated routers now also import `Duration` and `Interval` from luxon and emit the `_ZodInterval` helper when an operation uses those scalars, instead of referencing undefined names.

Plain type files emitted for the server render `binary` as `Buffer` rather than `Blob`. SDK output is unchanged. The standalone `types` sub-generator gained a `target` option (`"client" | "server"`, default `"client"`) to select between the two.
