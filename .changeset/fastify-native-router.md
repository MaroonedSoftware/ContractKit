---
'@contractkit/plugin-typescript': minor
---

Rebuild Fastify router generation on `@maroonedsoftware/fastify`'s native-Fastify API (0.3+), which replaced its Koa-shaped `ServerKitRouter` with ordinary Fastify plugins.

A generated router is now a `FastifyPluginAsync` rather than a `ServerKitRouter()` value, and each handler declares its body allow-list through `config.body` instead of a `bodyParserMiddleware(...)` call:

```ts
export const BillingRoutes: FastifyPluginAsync = async app => {
    app.post('/payments', { config: { body: ['application/json'] }, preHandler: [requirePolicy()] }, async (request, reply) => {
        const body = await parseAndValidate(request.body, PaymentInput);

        const service = request.container.get(PaymentService);
        const result: Payment = await service.create(body);

        reply.status(200);
        reply.type('application/json');
        return reply.send(result);
    });
};
```

What changed from the previous adapter:

- **Routes are plugins, not router methods.** Register the generated file with `builder.setupRoutes([BillingRoutes])` (or `{ plugin: BillingRoutes, prefix: '/api' }`), the same as any other Fastify route plugin. `ServerKitRouter` and `bodyParserMiddleware` are gone from `@maroonedsoftware/fastify`'s public surface, so generated code no longer imports either.
- **The parsed body is Fastify's own `request.body`.** `request.parsedBody` no longer exists; `bodyParserPlugin` now replaces Fastify's content-type parsers outright rather than adding a side channel.
- **A route's body allow-list is declarative.** `config.body` lists the literal content types the operation declares (`['application/json']`), not a parser token — Fastify gates on the raw `Content-Type` itself.
- **Guards live in `preHandler`.** `requirePolicy()` and `requireSignature(...)` are unchanged calls, now collected into a `preHandler` array on the route options rather than passed positionally before the handler.
- **Content-type dispatch no longer calls a runtime helper.** `requestMediaType` isn't part of the package's public surface any more; a multi-MIME operation's `switch` strips the header inline instead.
- **The generated router constant is named `...Routes`,** matching the plugin idiom, instead of `...Router`.

The generated `mcp.router.ts` follows the same shape: `mountMcp` is now a `FastifyPluginAsync` registered with `builder.setupRoutes([mountMcp])`, instead of a function taking a router instance.

`koa` remains the default and its output is unchanged.
