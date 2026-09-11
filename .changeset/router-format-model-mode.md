---
'@contractkit/plugin-typescript': patch
---

The generated router now compiles and validates when a `query:`, `headers:` or `params:` block references a `format()` model.

A model such as `contract format(input=snake) SnakeFilter: { fromDate?: date }` compiles to `z.strictObject({ from_date: ... }).transform(...)`, a `ZodPipe`. The router applied the block's object mode as a method on that schema, `parseAndValidate(ctx.query, SnakeFilter.strict())`, but a pipe has no `.strict()`, `.strip()` or `.loose()`. The router failed `tsc` with TS2339 ("Property 'strict' does not exist on type 'ZodPipe<...>'") and threw at run time. This hit Koa and Fastify alike, and `format(output=)` models, models that inherit `format()` from a base, and aliases of such models too.

The mode now goes on the object inside the pipe, and the result is piped back through the model's own transform: `SnakeFilter.in.strict().pipe(SnakeFilter.out)`. The block's mode wins over the model's own, as it does for any other model, so a `headers:` block still strips the headers it does not declare (`SnakeHeaders.in.strip().pipe(SnakeHeaders.out)`) instead of the model's strict object rejecting every one of them. A model without `format()` is validated exactly as before.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `8`, so an existing incremental cache regenerates its routers. A router's cache fingerprint now also covers which of its param models compile to a pipe, so a model in another `.ck` file gaining or losing `format()` regenerates the router.
