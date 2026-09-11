---
'@contractkit/plugin-python': patch
---

Stop calling `model_validate` and `model_dump` on contracts that are not Pydantic classes.

A contract declared as a type rather than an object is emitted as a Python type alias: `contract Tier: enum(free, pro)` becomes `Tier = Literal["free", "pro"]`, and `contract Method: discriminated(by=kind, Card | Bank)` becomes `Method = Annotated[Card | Bank, Field(discriminator="kind")]`. The client treated every capitalised ref as a model class, so a method returning one of these raised `AttributeError: model_validate` on every call, and a request body of `Tier` raised `'str' object has no attribute 'model_dump'` before the request was sent.

The plugin now works out which contracts are aliases. A request body of one is serialized through a module-level `TypeAdapter`, like any other body that is not a single model:

```python
_PUT_TIER_BODY = TypeAdapter(Tier)
...
body=_PUT_TIER_BODY.dump_python(body, mode="json", by_alias=True, exclude_unset=True)
```

A response of one is returned without the failing call. A contract that only renames a model (`contract B: A`, emitted as `B = A`) is still a class and keeps `model_validate`.

The client file's cache fingerprint now includes which referenced contracts are aliases, so changing a contract between an object and a type regenerates the clients that use it.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
