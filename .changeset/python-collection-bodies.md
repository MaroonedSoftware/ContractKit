---
'@contractkit/plugin-python': patch
---

Serialize request bodies that are not a single model: lists, records, tuples and unions of models.

Only a body that was exactly one model went through `model_dump`. Anything else was handed to httpx as the caller passed it, so `request: { application/json: array(Item) }` failed before the request left the process with `TypeError: Object of type Item is not JSON serializable`. The same happened for `record(string, Item)`, a union of models, and any body holding a `date`, `Decimal` or `UUID` that httpx cannot encode itself.

Each such operation now gets a module-level `TypeAdapter` for its body type, built once at import:

```python
_CREATE_PAYMENTS_BODY = TypeAdapter(list[PaymentInput])
...
body=_CREATE_PAYMENTS_BODY.dump_python(body, mode="json", by_alias=True, exclude_unset=True)
```

It uses the same flags as a single model's `model_dump`, so every model inside the body goes out under its contract field names, with unset optionals left out and a required nullable field's `null` kept. JSON and urlencoded bodies both use it. A single-model body keeps `model_dump`, and multipart, text and binary bodies still go out as passed.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
