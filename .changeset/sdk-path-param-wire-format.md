---
'@contractkit/plugin-typescript': patch
---

SDK path params typed `date`, `time`, `decimal`, `datetime`, `duration` or `bigint` now compile and reach the router in a form it parses.

An inline path param is passed to `encodeURIComponent`, which accepts only `string | number | boolean`, so a `DateTime`, `Duration`, `Decimal` or `bigint` argument failed to compile. A field of a `params: Model` argument compiled, since it was wrapped in `String()`, but a `date` or `time` then went out as a full ISO timestamp and the router answered 400. Path params now use the same serialization as query and header params: `toFormat()` with the scalar's format for `date` and `time`, `toFixed()` for `decimal`, and `String()` for `datetime`, `duration` and `bigint`, whose string form the router already parses.
