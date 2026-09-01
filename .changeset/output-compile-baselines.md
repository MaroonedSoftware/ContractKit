---
---

Add compile and parse baselines to `packages/output-tests`, so the harness observes whether the generated code is *valid* and not only whether it is unchanged.

Three checks, one per output language:

- **TypeScript** is run through `ts.createProgram` under `strict`, `noUnusedLocals`, `noUnusedParameters` and `noUncheckedIndexedAccess`. Server and SDK output compile as two separate programs, because they compile under genuinely different assumptions: the server is a Node application and may refer to `Buffer`, while the SDK is the package its own `scaffold: true` `package.json` describes, which declares no `@types/node`. Checking them together would either excuse a real defect in the SDK or invent one in the server.
- **OpenAPI** is read with `yaml`'s document API rather than `parse`, since a plain JavaScript object coerces every key to a string and so destroys the distinction being checked: OpenAPI 3.x requires string `responses` keys, and a bare `200:` is read by a YAML 1.2 parser as an integer.
- **Python** is parsed with `ast`, plus two checks `ast.parse` alone cannot make. The defect that shipped leaves the file syntactically valid, with a snake_cased method signature and an f-string still interpolating the raw contract name, so it imports fine and raises `NameError` when called. Every f-string is walked for the identifiers it reads and each is checked against the names its enclosing function binds. A sibling check catches paths emitted as plain strings with the placeholder left literal, which is what happens when the param name is not a valid Python identifier and no f-string is produced at all.

All three **record** their findings rather than asserting them empty. Asserting empty today would land a red test; recording means each later fix shrinks the file, the shrinking file is the progress indicator, and the last change in this batch flips them to hard assertions.

External dependencies are stubbed in `tests/ambient.d.ts` rather than installed, except `zod`, which is resolved for real because the emitted type aliases are `z.infer<...>` over the emitted schemas and a stub would make every one of them vacuously `any`.

No published package changes; this is test infrastructure only.
