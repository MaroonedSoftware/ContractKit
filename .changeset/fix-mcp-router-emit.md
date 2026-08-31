---
'@contractkit/plugin-typescript': patch
---

Fix four defects in the emitted `mcp.router.ts` that left the generated MCP endpoint non-functional. It now emits `bodyParserMiddleware(['json'])` ahead of `requireSignature`, which is what populates the `ctx.rawBody` the signature HMAC is computed over; answers notifications with `else ctx.status = 202` instead of leaving `ctx.body` unset and 404ing the `notifications/initialized` that follows every handshake; wraps the body as `JSON.parse(String(ctx.rawBody))`, since `ctx.rawBody` is `BinaryLike` and `JSON.parse` takes a `string`; and hands the stateful transport `ctx.parsedBody` rather than `ctx.request.body`, which ServerKit never populates and which the new body parser's stream read would otherwise leave empty.
