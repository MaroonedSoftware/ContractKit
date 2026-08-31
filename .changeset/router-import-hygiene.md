---
'@contractkit/plugin-typescript': patch
---

Stop the generated Koa router emitting imports nothing in the file references

`collectTypes` and `collectServices` walk the AST, and the AST over-approximates what a router
actually uses in three ways:

- A model with an `Input` or `Output` variant contributed **both** its base name and the variant,
  even when only the variant is ever annotated. A response typed `AuthTokenOutput` emitted
  `import { AuthToken, AuthTokenOutput }`, and a request body validated against `CreateUserInput`
  emitted `import { CreateUser, CreateUserInput }`.
- Both collectors walk every operation, including the `internal` ones `includeInternal: false`
  drops. A router whose only operation was excluded still imported that operation's service and
  response model, with no handler left to use either.

In a consuming project with `noUnusedLocals` — or the equivalent lint rule — each of those is a
compile error in generated code the user cannot edit.

Every collected service and model name is now filtered through the same `uses` gate that already
prunes `parseAndValidate`, `requirePolicy`, `MultipartBody` and the luxon imports: a name is
imported only if it appears in the generated body. This is the approach the file's own comment
already argued for — deciding imports from the emitted text rather than from predicates over the
AST that have to be kept in step with it by hand.

Names that are genuinely used are unaffected, including a base model used as the runtime schema
under `server.validateResponses`. `@contractkit/plugin-typescript`'s MCP output does not have this
gap — its schema ids and service imports are both derived from the emitted tool plans.
