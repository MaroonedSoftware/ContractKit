---
'@contractkit/plugin-python': patch
---

Validate every JSON response against its declared type, not only a single model or a list of models.

Any other response went back to the caller as decoded JSON under the declared annotation. A method annotated `-> dict[str, Item]` returned plain dicts. A union of models, or a discriminated union, returned a dict. `array(bigint)` returned the wire strings (`["1", "2n"]`) instead of ints, and `array(date)` or `record(string, decimal)` returned strings instead of `date` and `Decimal`. Nested lists, tuples and lists of unions did the same.

Each such response type now gets a module-level `TypeAdapter`, built once at import, and the method returns its `validate_python` result:

```python
_ITEMS_BY_ID_RESPONSE = TypeAdapter(dict[str, Item])
...
return _ITEMS_BY_ID_RESPONSE.validate_python(result)
```

This covers methods that return the body directly, methods that also return response headers, and methods that report their status or content type. A method with several statuses gets one adapter per status (`_MULTI_RESPONSE_202`). Content types of one status that share a type share an adapter, and a second type is named after its mime (`_MIME_RESPONSE_VND_API_JSON`). A list of models now goes through an adapter too, replacing the list comprehension over `model_validate`. A single model keeps `model_validate`. Text, binary and `Any` responses are returned as they arrive.

A response that does not match its declared type now raises `pydantic.ValidationError`, which a single-model response already did. Before, it came back unchecked.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
