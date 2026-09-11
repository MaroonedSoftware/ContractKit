---
'@contractkit/plugin-python': patch
---

The generated Python SDK passes `mypy --strict`.

A multipart body and an inline `query:` or `headers:` block that declares no fields were typed as a bare `dict`, which `--strict` reports as a missing type argument in every project that type-checks its use of the SDK. They are now `dict[str, Any]`, with the `Any` import they need. Together with the base client's `Mapping[str, Any] | BaseModel | None` parameters, the output-tests snapshot package now type-checks clean under `mypy --strict`; before this batch it reported 15 errors, most of them generated calls that pass a query or header `TypedDict`.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
