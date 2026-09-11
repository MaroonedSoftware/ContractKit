---
'@contractkit/plugin-kotlin': patch
---

A status that declares several content types and response headers now generates a client that compiles.

The method passed `headers` to every leaf of its sealed response but never declared it, so the generated Kotlin referenced an unresolved `headers`. It now reads the declared headers into `<Method>Headers` (or `<Method>ResponseHeaders` when the operation also declares request headers) before dispatching on the content type, as the multi-status path already did.

`KOTLIN_CODEGEN_VERSION` is bumped to `2`, so a warm `.contractkit/cache` does not keep the broken client across the upgrade.
