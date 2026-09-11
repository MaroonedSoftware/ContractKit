---
'@contractkit/plugin-swift': patch
---

A status that declares several content types and response headers now generates a client that compiles.

The method passed `headers` to every case of its response enum but never declared it, so `swift build` failed with "cannot find 'headers' in scope". It now reads the declared headers into `<Method>Headers` (or `<Method>ResponseHeaders` when the operation also declares request headers) before switching on the content type, as the multi-status path already did. The output-tests fixture now covers this shape, so the Swift compile check guards it.

`SWIFT_CODEGEN_VERSION` is bumped to `2`, so a warm `.contractkit/cache` does not keep the broken client across the upgrade.
