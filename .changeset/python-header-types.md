---
'@contractkit/plugin-python': minor
---

Type and coerce response headers from the contract, instead of calling everything `str`.

The generated per-method `TypedDict` annotated every response header `str` and assigned the raw value. That was at least self-consistent, but it discarded the declared type: a header the contract calls `int` reached the caller as a string, and `mypy` and `pyright` users saw `str` where they had written `int`.

The annotation now comes from the contract and the value is coerced to match it. The accepted set mirrors the TypeScript SDK's, with one asymmetry worth stating: temporals need real conversion here, because `renderPyType` maps them to `date`/`time`/`datetime` objects, while the TypeScript side maps them to `string` and passes the raw value straight through.

| Declared type | Python type | Read as |
| --- | --- | --- |
| `string`, `email`, `url`, `interval` | `str` | the raw value |
| `int`, `bigint` | `int` | `int(...)` |
| `number` | `float` | `float(...)` |
| `boolean` | `bool` | compared against `"true"` |
| `uuid` | `UUID` | `UUID(...)` |
| `date`, `time`, `datetime` | the matching class | `.fromisoformat(...)` |
| anything else | | rejected at codegen |

`duration` is rejected even though the TypeScript SDK accepts it: it maps to `timedelta`, and the standard library has no ISO 8601 duration parser to convert a header string with. Half-supporting it would mean an annotation the runtime does not honour, which is the defect being fixed.

A related gap goes with it: `collectReferencedModels` walked response *bodies* but not response *headers*, so a header declared `datetime` or `uuid` would have missed the stdlib import it needs.

**Minor rather than patch**, because the annotation on a generated `TypedDict` changes and type-checked call sites will see it.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch.
