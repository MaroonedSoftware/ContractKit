---
'@contractkit/plugin-typescript': patch
---

The generated router now accepts a one-element array in a `query:` declared as a model.

`query: Filter` validated `ctx.query` against `Filter` itself, the schema request bodies use, whose `tags: z.array(z.string())` has no query-string handling. A query string carries a one-element list as `tags=only`, which Koa and Fastify both parse to the string `"only"`, so the request failed with "expected array, received string" whatever the client sent. Two or more values, as repeated keys, passed. An inline query block was never affected: its array fields already split a bare string on commas.

The router now re-wraps each array field of a query model in that same split, reading the field off the model's own `.shape` so its modifiers carry over: `Filter.extend({ tags: z.preprocess(split, Filter.shape.tags) }).strict()`. This covers fields inherited from a base, the `Input` variant of a model with visibility modifiers, and a model that is one member of an intersection such as `query: Filter & { q: string }`. A model with no array field is validated exactly as before.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `5`, so an existing incremental cache regenerates its routers. A router's cache fingerprint now also covers the fields of a model its `query:` references, so adding an array field to such a model in another `.ck` file regenerates the router too.
