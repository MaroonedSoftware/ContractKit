---
'@contractkit/plugin-python': patch
---

Send query and header params in the forms a ContractKit router parses, including a `query:` or `headers:` declared as a model.

**Model refs.** An operation declaring `query: Filter` or `headers: Tenant` took a Pydantic model and passed it straight to httpx, which raised `AttributeError: 'Filter' object has no attribute 'items'`; the header merge raised `TypeError: 'Tenant' object is not a mapping`. The base client now dumps a model the way it dumps a request body, `model_dump(mode="json", by_alias=True, exclude_unset=True)`, so each field goes out under its contract name and unset optionals are left out.

**Inline blocks.** The `TypedDict` for an inline block holds Python values, and httpx `str()`s them. A `datetime` went out as `2026-01-02 03:04:00+00:00`, which the router's ISO 8601 parser rejects, and a `None` as an empty value, which a numeric schema rejects. Values are now converted to their JSON forms first (ISO dates and datetimes, decimal and UUID strings, exact bigints), and a `None` is left out, since neither a query string nor a header can express null.

**Headers.** httpx accepts only text header values, so any inline header typed `int`, `boolean`, `date` or `uuid` raised `TypeError` before the request was sent. Header values are now sent as text, booleans as `true`/`false`, lists comma-joined.

The base client's `params` and `extra_headers` parameters are typed `Mapping[str, Any] | BaseModel | None`, which accepts a `TypedDict` or a model.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
