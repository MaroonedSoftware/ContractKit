---
'@contractkit/plugin-python': minor
---

Emit a `TypedDict` for inline `query:` and `headers:` blocks, instead of a bare `dict`.

`renderParamSourceType` returned `dict` for an inline param block, so the generated signature said nothing about what the request actually accepts:

```python
async def list_payments(self, query: dict | None = None, custom_headers: dict | None = None) -> list[Payment]:
```

The router has always validated those fields, so a typo in a key was a runtime 400 with nothing to catch it first. Each block now gets a module-level `TypedDict` named after its method, alongside the response-header ones already emitted there:

```python
class ListPaymentsQuery(TypedDict):
    limit: NotRequired[int]  # limit
    cursor: str  # cursor
```

Optionality follows the contract, with the same rule the TypeScript SDK and the OpenAPI document now use: a field is omittable when it is declared with `?` or carries a default, and the argument itself is optional only when every field is. `NotRequired` rather than `total=False`, so a required field in a mixed block stays required.

Python's parameter ordering constraint is the same as TypeScript's but stricter in kind: a defaulted parameter cannot precede a bare one, and that is a `SyntaxError` rather than a type error. Arguments before the last required one are widened to required, which keeps the positional order every call site depends on.

A `query:` or `headers:` declared as a model reference is unchanged and stays optional — deciding needs the model's own fields, which this generator does not have.

### What this breaks

**`query: dict | None` narrows to a `TypedDict`.** `mypy` and `pyright` users will see new errors on loosely typed call sites, which is the point: those call sites were passing dictionaries nothing checked.

**`NotRequired` requires Python 3.11.** `requirements.txt` pins only `httpx` and `pydantic>=2.0` and states no floor, so this is the first version constraint the generated SDK carries. It applies only to clients that have an inline `query:` or `headers:` block with an optional field.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
