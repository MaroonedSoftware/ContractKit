---
'@contractkit/plugin-typescript': patch
---

A generated router can now return a `bigint`. Koa's respond step and Fastify's default serializer both hand an object body to a bare `JSON.stringify`, which throws `TypeError: Do not know how to serialize a BigInt`, so every route whose response model carried one answered 500.

A JSON response whose type reaches a `bigint`, directly or through a contract in any `.ck` file, is now serialized with ServerKit's `bigIntReplacer` from `@maroonedsoftware/utilities`: Koa writes `ctx.body = JSON.stringify(body, bigIntReplacer)`, and Fastify sets a per-reply `reply.serializer(...)`, which keeps the payload an object through `preSerialization` hooks. The value goes out as `"123n"`, which the TypeScript SDK's reviver reads back and the Kotlin, Swift, C# and Python SDKs read by dropping the `n`. A status declaring a bigint JSON body next to another content type branches on `result.contentType`, so the other body is written as before.

A server whose contracts put a `bigint` in a response now imports `@maroonedsoftware/utilities` and needs it as a dependency. Routes with no `bigint` below them generate exactly what they did. `TYPESCRIPT_CODEGEN_VERSION` is bumped to `3` so cached routers regenerate.
