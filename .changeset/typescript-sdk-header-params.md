---
'@contractkit/plugin-typescript': patch
---

An SDK method whose operation declares a non-string header param now typechecks. The `headers:`
argument went to `fetch` as-is, and `HeadersInit` takes only strings, so `x-limit?: int` failed with
TS2322 in the generated client. It was wrong at run time too: an optional header passed as
`undefined` went out as the text "undefined". The argument now goes through a new `buildHeaders`
helper in the SDK runtime, which, like `buildQueryString`, stringifies each value and drops absent ones.
