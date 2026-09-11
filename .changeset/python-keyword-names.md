---
'@contractkit/plugin-python': patch
---

Escape Python keywords in generated names, so a contract field or path param called `class` or `from` no longer produces a module that fails to import with a `SyntaxError`.

A name that becomes a hard keyword once snake-cased now gets a trailing underscore: `class` becomes `class_`. On a model field, the differing name is what triggers the existing alias, so the field is `class_: str = Field(alias="class")` and still goes on the wire as `class`. The same applies to path-param arguments and to response-header `TypedDict` keys (the HTTP `From` header becomes `from_`). Soft keywords (`type`, `match`, `case`) are valid names and are left alone.

A path param also can no longer take a name the method already uses: `body`, `query`, `custom_headers` or `self` (a duplicate-argument `SyntaxError`), or `quote` and `str`, which the URL expression calls. Those get the same trailing underscore.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
