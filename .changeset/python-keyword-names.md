---
'@contractkit/plugin-python': patch
---

A path param can no longer take a name its method already uses, which produced a module that failed to import or a method that failed when called.

`body`, `query`, `custom_headers` and `self` are the method's own arguments, so a path param with one of those names was a duplicate-argument `SyntaxError`. `quote` and `str` are the functions the URL expression calls, so a path param named either shadowed it and the call failed. Those names now get a trailing underscore (`body_`, `quote_`), as a keyword already does since 0.14.3. Only the Python argument is renamed; the request path is unchanged.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
