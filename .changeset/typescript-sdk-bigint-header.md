---
'@contractkit/plugin-typescript': patch
---

The TypeScript SDK reads a `bigint` response header in the documented wire form, `^-?\d+n?$`, and throws a descriptive error for anything else.

The client called `BigInt()` on the raw header value. That threw an opaque `SyntaxError` on `123n`, a form the OpenAPI output documents, and on a malformed value like `abc`, and it accepted `0x10`, `""` and `" 7"` as `16n`, `0n` and `7n`. Clients now read the header through a new `parseBigIntHeader` helper in `sdk-options.ts`, which accepts an optionally negative run of digits with an optional trailing `n` and otherwise throws `Response header 'x-total' is not a bigint: "abc"`. It is imported only by a client that reads a bigint header.
