---
'@contractkit/plugin-python': minor
---

Key the query and header `TypedDict`s by the names that go on the wire.

The `TypedDict` for an inline `query:` or `headers:` block is passed to httpx as-is, so its keys are what the server receives. They were snake_cased Python names: a call typed correctly against `ListPaymentsHeaders` sent an `x_tenant` header where the server reads `x-tenant`, and a query typed against `pageSize` sent `page_size`, which the router's strict query schema rejects. A keyword such as a `from` query param could not be written in the class syntax at all, and was a `SyntaxError`.

The `TypedDict`s now use the functional form, whose keys can be any string:

```python
ListPaymentsHeaders = TypedDict("ListPaymentsHeaders", {
    "api-key": NotRequired[str],
    "x-tenant": str,
})
```

The class names and the method signatures that take them are unchanged.

**Minor rather than patch, because the keys a type checker accepts change.** Code that passes `{"x_tenant": ...}` is now a type error. It never reached the server as `x-tenant`, so it could not have been working, and at runtime the dict is still sent as given.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
