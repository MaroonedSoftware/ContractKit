---
'@contractkit/plugin-typescript': minor
---

Add `server.framework`, and render the generated router through a framework adapter.

The server sub-generator emitted the Koa flavour of ServerKit inline: `ServerKitRouter()`, `async ctx => {`, `ctx.params`, `ctx.parsedBody`, `ctx.container.get`, `ctx.status`, `ctx.set`, `ctx.type`, `ctx.body`, and a wholly Koa-specific `mcp.router.ts`. Every one of those strings now comes from a `ServerFramework` adapter, and `server.framework` selects it:

```json
"server": { "framework": "koa", "baseDir": "apps/api/" }
```

`koa` is the only supported value and the default, so **generated output is unchanged, byte for byte** — the option exists so a later release can target another framework without touching the generator. A name with no adapter fails config validation rather than emitting code that cannot run:

```
plugin-typescript: server.framework 'express' is not supported — expected one of: koa.
```

The optional `mcp.router.ts` follows the same setting, including when there is no `server` sub-config at all, where it stays Koa.

Two internal changes came with it. `generateParamValidation` decided whether it was rendering query params or path params by comparing its accessor argument against the literals `'ctx.query'` and `'ctx.params'`, so the query-string array coercion and the destructuring of path params both hung on the exact spelling of a Koa accessor; it now takes the kind explicitly. And the response seam is shaped for a framework that ends a response by returning rather than by assigning: the adapter supplies the terminal statement for bodyless responses too, and supplies whatever closes a status case, since a `return` followed by a `break` is unreachable code.
