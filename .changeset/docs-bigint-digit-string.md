---
'@contractkit/plugin-docs': minor
---

Document `bigint` as what goes over the wire: a digit string, not a JSON integer.

The OpenAPI target described a `bigint` as `type: integer, format: int64`, but no ContractKit client sends a number for one. The TypeScript SDK writes `"123n"`, the Kotlin, Swift, C# and Python SDKs write `"123"`, and the generated server's schema rejects a JSON number. A third-party client generated from the spec therefore sent a number and had its request rejected, and the server's own responses failed validation against the spec. A `bigint` is now `type: string, format: bigint, pattern: '^-?\d+n?$'`. The pattern accepts both forms every ContractKit client reads, and rejects a number, a decimal or anything else. `format: bigint` rather than `int64` because the value is unbounded, and a generator keyed on `int64` alone could still map it to a 64-bit number. Bounds go in `x-contractkit-min` / `x-contractkit-max`, as `decimal`'s already do, since `minimum`/`maximum` are ignored on a string. A field default is written as a string so the schema accepts it. `@contractkit/openapi-to-ck` reads the new form back as `bigint`.

The Markdown target and the Docusaurus target that shares its renderer keep `bigint` in the type column and add *sent as a digit string, "123" or "123n"* to the description, including under a `bigint` type alias. Mintlify pages render from the emitted OpenAPI, so they pick up the new schema directly.

**Minor rather than patch, because the published spec changes shape.** Anything generated from an earlier spec had `bigint` fields as integers, and needs regenerating to talk to a ContractKit server, which it could not do before either.
