---
'@contractkit/plugin-python': patch
---

The generated Python SDK passes `mypy --strict`.

A multipart body and an inline `query:` or `headers:` block that declares no fields were typed as a bare `dict`, which `--strict` reports as a missing type argument in every project that type-checks its use of the SDK. They are now `dict[str, Any]`, with the `Any` import they need. Every module-level `TypeAdapter` is now annotated (`_TIER_RESPONSE: TypeAdapter[Tier] = TypeAdapter(Tier)`), because mypy cannot infer the parameter of one built from an `Annotated` alias such as a discriminated union. Together with the base client's `Mapping[str, Any] | BaseModel | None` parameters, the output-tests snapshot package now type-checks clean under `mypy --strict`; on 0.15.0 it reported 14 errors, most of them generated calls that pass a query or header `TypedDict`.

`PYTHON_CODEGEN_VERSION` is bumped to `4`, so a warm `.contractkit/cache` does not keep the 0.15.0 clients across the upgrade.
