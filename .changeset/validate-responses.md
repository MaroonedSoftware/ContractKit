---
'@contractkit/plugin-typescript': minor
'@contractkit/core': minor
---

Add `server.validateResponses` — the generated Koa router can now validate what it sends, not just
what it receives

Handlers have always run request params, query, headers and body through `parseAndValidate`. The
service's return value got nothing: it was type-annotated and assigned straight to `ctx.body`, so a
service returning a shape its own contract forbids shipped it to the client unchanged. With
`server.validateResponses: true` the result is re-parsed against the declared response schema and
the *parsed* value is written:

```ts
const result: User = await service.getById(id);

ctx.status = 200;
ctx.type = 'application/json';
ctx.body = await parseAndValidate(result, User, 500);
```

Because the parsed value is what reaches the wire, `mode(strip)` now actually strips extra keys off
responses.

- **Opt-in, and off by default**, because turning it on surfaces real drift. TypeScript only
  excess-property-checks object *literals*, so a service returning a database row with undeclared
  columns satisfies `const result: User` today and quietly ships them; under the default `strict`
  mode that becomes a 500. That is the flag working, but it is not a change to make on a Friday.
- **`zod: true` is a hard prerequisite.** Without it `output.types` emits plain interfaces — types
  with no runtime schema value to validate against. Setting `validateResponses` alone now fails the
  build with an explicit message instead of emitting code that cannot compile. This is the plugin's
  first config assertion; it runs for both the default export and `createTypescriptPlugin`.
- **Requires `@maroonedsoftware/zod` 0.6.1 or later** for the `statusCode` argument. Failures are
  raised as `500`, not the `400` a request-side failure gets — a service breaking its own contract
  is a server fault. At 5xx that package puts the field-level map on `internalDetails` rather than
  `details`, so `errorMiddleware` keeps it out of the response body and on the log path.

Two kinds of response body are deliberately left unvalidated, and generate exactly as before:

- **Anything transitively referencing a model with `format(input=…)` or `format(output=…)`.** Those
  schemas transform keys between wire and developer-facing casing, and the service already returns
  the post-transform shape, so re-parsing it through the same schema would fail on every key. Note
  this needs a wider set than `modelsWithOutput`, which seeds only from `outputCase` because only
  that case needs an `Output` type alias — a `format(input=snake)`-only model is just as
  untouchable. `@contractkit/core` gains `computeModelsWithCaseTransform` for it.
- **A status whose several content types carry different body shapes**, where `contentType` and
  `body` are correlated across union members. Matching shapes (`image/png` and `image/jpeg` both
  `binary`) share one schema and validate normally.

One wart worth knowing: `ctx.status` and any `ctx.set(…)` response headers are written before the
body, so a validation failure raises its 500 with the success path's headers already set.

Projects that do not set the flag generate byte-identical routers.
