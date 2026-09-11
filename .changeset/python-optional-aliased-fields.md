---
'@contractkit/plugin-python': patch
---

Optional fields that need an alias are optional again.

A field whose Python name differs from its contract name (`processingTime` → `processing_time`, `x-topic` → `x_topic`) is emitted with `Field(alias=...)`. That moved the right-hand side into the `Field` call and dropped the `= None` every other optional field gets, and to Pydantic a `Field` with no default is required. So `processingTime?: duration` became a field every caller had to pass, and every response that omitted it (which is what a ContractKit server does with an absent optional) failed `model_validate`.

An optional field with no declared default now emits `Field(alias="processingTime", default=None)`. A declared default still wins, and a required nullable field (`billTo: Address | null`) stays required, as the contract says.

`PYTHON_CODEGEN_VERSION` is bumped to `3`, so a warm `.contractkit/cache` does not keep the old models across the upgrade.
