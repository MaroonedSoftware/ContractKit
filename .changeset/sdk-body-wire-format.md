---
'@contractkit/plugin-typescript': patch
---

The SDK now sends `date`, `time` and `decimal` values in a JSON or urlencoded request body in the text the generated router parses.

A body went out through `JSON.stringify(body, bigIntReplacer)` (or `new URLSearchParams(body)`), and a `date` or `time` field is a luxon `DateTime`, whose `toJSON()` is `toISO()`. So `{ day: DateTime.fromISO('2026-09-11') }` was sent as `{"day":"2026-09-11T00:00:00.000-04:00"}`, and the router, which parses these with `DateTime.fromFormat` against the contract's format, rejected every such request with a 400. A `decimal` went out in exponential notation (`1e-8`) whenever decimal.js had not been configured in that module.

SDK type files now declare a `serializeX()` beside each contract whose request shape holds one of these scalars, directly, through a base, or through a contract it references. It writes a `date` or `time` with `toFormat()` in the field's format (`yyyy-MM-dd` and `HH:mm:ss` by default) and a `decimal` with `toFixed()`, walking nested contracts, arrays, records, tuples, inline objects, discriminated unions (by tag) and nullable members, under the `format(input=)` key casing the server parses. It returns a copy and never modifies the caller's object. A value that is already a string passes through unchanged, so a plain JavaScript caller sending `'2026-09-11'` keeps working. SDK methods pass the body through it before stringifying; a body that is not a plain contract reference, such as an inline object, gets an equivalent function in the client file. A plain union with more than one member of the same runtime class (`date | time`, or two contracts) is left as `toJSON` writes it, since there is no way to tell which member a value is. Bodies with nothing to rewrite are generated unchanged.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `9`, so an existing incremental cache regenerates its clients and type files.
