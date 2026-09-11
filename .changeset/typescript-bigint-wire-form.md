---
'@contractkit/plugin-typescript': patch
---

The Zod schema for a `bigint` now converts only a string in the documented wire form, `^-?\d+n?$`, and rejects anything else with a validation issue.

The preprocess called `BigInt()` on every string. A value like `"abc"` made `BigInt` throw a `SyntaxError` inside the preprocess, which escaped Zod and `parseAndValidate`, so the request failed with a 500 instead of a 400. And `BigInt()` accepts more than the wire form: `"0x10"`, `""` and `" 7"` validated as `16n`, `0n` and `7n`, though the OpenAPI output documents a bigint as `type: string, pattern: '^-?\d+n?$'`. Each of these now fails validation with `Expected bigint`, the same as a JSON number already did.

The change applies everywhere the scalar is rendered: server schemas (Koa and Fastify), the SDK's Zod schemas, the standalone `zod:` output, and query and header params, which still accept `"123"` and `"123n"`. `min`/`max` bounds stay on the inner `z.bigint()`.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `4`, so an existing incremental cache regenerates every file instead of keeping the old schema.
