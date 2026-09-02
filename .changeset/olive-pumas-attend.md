---
'@contractkit/plugin-typescript': minor
---

Generate Fastify routers with `server.framework: "fastify"`.

```json
"server": { "framework": "fastify", "baseDir": "apps/api/" }
```

Output targets `@maroonedsoftware/fastify`, whose exported surface mirrors the Koa one, so a contract compiles to the same handlers either way:

```ts
BillingRouter.post('/payments', requirePolicy(), bodyParserMiddleware(['json']), async (request, reply) => {
    const body = await parseAndValidate(request.parsedBody, PaymentInput);

    const service = request.container.get(PaymentService);
    const result: Payment = await service.create(body);

    reply.status(200);
    reply.type('application/json');
    return reply.send(result);
});
```

Three differences are worth knowing before you switch:

- **The request is the context.** Handlers take `(request, reply)`, and params, query, headers, the DI container and the parsed body all hang off `request`. Fastify's own `request.body` is never populated, because ServerKit parses lazily per route.
- **Responses are returned, not assigned.** A handler that neither returns a body nor calls `send` leaves the request hanging, so a bodyless 204 emits an explicit `return reply.send();` where Koa emits nothing at all.
- **Content type comes from `requestMediaType(request)`.** Fastify has no accessor that strips the parameters off the header, and a raw `application/json; charset=utf-8` matches none of the MIME literals an operation declares.

`koa` remains the default and its output is unchanged. The generated `mcp.router.ts` follows the setting, using `reply.hijack()` where the Koa mount sets `ctx.respond = false`.

Separately, a path parameter whose name collides with an identifier the handler already binds is now renamed. `/threads/{reply}` emitted `const { reply } = ...` inside `async (request, reply) => {`, a redeclaration under `tsc` and a temporal-dead-zone `ReferenceError` at runtime; the same held on Koa for a parameter named `ctx`, and on both for one named after a generator local such as `body` or `query`. Only the local binding moves, so the wire name, the schema key and the route placeholder are untouched.
