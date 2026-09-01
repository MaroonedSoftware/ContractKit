---
'@contractkit/plugin-typescript': patch
---

Coerce SDK response headers to the types the return shape declares.

`renderSdkHeadersShape` types the `headers` object from the contract, while `sdkHeaderEntries` assigned `result.headers.get(name) ?? undefined` regardless. That produced `TS2322` in both directions at once: a header declared `int` was typed `number` and given a `string | undefined`, and a *required* header was typed `T` and given `T | undefined`. Neither compiled.

The value expression now follows the resolved scalar, and this table is shared with the Python SDK:

| Declared type | Expression |
| --- | --- |
| `string`, `email`, `url`, `uuid`, the date/time types, `unknown` | the raw value, asserted or defaulted per optionality |
| `int`, `number` | `Number(...)`, guarded on `null` when optional |
| `boolean` | compared against `'true'`, guarded on `null` when optional |
| `bigint` | `BigInt(...)`, guarded on `null` when optional |
| anything else | rejected at codegen |

Optionality drives the null handling: `Headers.get` returns `null` for an absent header, so an optional header maps that onto `undefined`, which is what its `?` in the shape means, while a required one is asserted because the contract says the service always sends it.

A header declared as a `decimal`, a `json`, a `binary`, a model reference, an array or an object is now a build error naming the header and the operation, which the CLI reports scoped to this plugin. Header values arrive as strings and there is no meaningful reading of those types from one; emitting code that does not compile is worse than refusing.

The Python SDK reuses this table, with one asymmetry worth stating: temporals *do* need coercion there, because `renderPyType` maps them to `datetime`/`date`/`time` objects while `renderOutputTsType` maps them to `string`.

No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
