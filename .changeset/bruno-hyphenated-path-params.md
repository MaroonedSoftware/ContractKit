---
'@contractkit/plugin-bruno': patch
---

Convert hyphenated path parameters in generated Bruno requests.

`openCollectionPath` matched `[a-zA-Z_][a-zA-Z0-9_]*`, so `/invoices/{invoice-id}` was emitted as a URL with the braces still in it, and `extractPathParamNames` missed the parameter entirely — the request had no `params:` entry to fill in. The request was unusable.

Both now use core's shared placeholder pattern, and the variable is named through `toIdentifier` for the same reason the Koa router does it: Bruno's `:variable` syntax stops at the first character a name cannot contain, so `:invoice-id` would bind `:invoice` and leave `-id` as literal path text. The `params:` entry uses the same name so the two agree.

The type lookup still keys on the contract's own spelling, so the generated example value matches the declared scalar. The request's display name also still echoes the contract path, which is what a reader wants to see.
