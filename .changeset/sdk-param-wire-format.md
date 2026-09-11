---
'@contractkit/plugin-typescript': patch
---

The SDK now sends `date`, `time` and `decimal` query and header params in the text the generated router parses, instead of `String(value)`.

A `date` or `time` param is typed as a luxon `DateTime`, and `buildQueryString` and `buildHeaders` stringified it with `toISO()`, so `2026-09-11` went out as `2026-09-11T00:00:00.000-04:00`. The router parses these with `DateTime.fromFormat` against the contract's format, so every such request failed with a 400. A `decimal` went out in exponential notation (`1e-8`) whenever decimal.js had not been configured in that module, which the router happened to accept but the documented pattern `^-?\d+(\.\d+)?$` does not.

Each SDK method now writes these values itself, at the call site, where the declared type is known: `toFormat()` with the scalar's `format` (`yyyy-MM-dd` and `HH:mm:ss` by default) for `date` and `time`, and `toFixed()` for `decimal`. This covers inline params, `query: Model` and `headers: Model` (including inherited fields and `format(input=)` key casing), arrays of these scalars, and type aliases such as `contract Day: date("yyyyMMdd")`. A method whose params already stringified correctly (`datetime`, `duration`, `int`, `bigint`, `boolean`, strings) is generated unchanged.

`TYPESCRIPT_CODEGEN_VERSION` is bumped to `5`, so an existing incremental cache regenerates its clients. The cache fingerprint for a client now also covers the fields of a model its `query:` or `headers:` references, so changing such a field's type or format regenerates the client too.
