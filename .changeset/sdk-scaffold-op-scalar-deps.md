---
'@contractkit/plugin-typescript': patch
---

The `scaffold: true` SDK `package.json` now declares `luxon` and `decimal.js` when an operation needs them, not only when a model does.

The dependencies were derived from the contract models surfaced into the SDK, but a client file names `DateTime`, `Duration` or `Decimal` on its own for an inline path, query or header param, an inline request or response body, or a response header. A project whose only temporal or decimal type lived in one of those places got a `package.json` with no `luxon` or `decimal.js`, and the SDK failed to compile. The scaffold now also walks every operation a client is generated for (internal ones only with `includeInternal`). An `interval` op param still adds nothing, since a client types it as a plain string.

The scaffolded `package.json` is write-once, so an existing one is not rewritten. Add the missing dependency by hand, or delete the file and regenerate.
