---
'@contractkit/plugin-python': patch
---

Cast a text, event-stream or binary response body to `str` or `bytes` before a method returns it. The base client's `_fetch` returns `Any`, so the bare `return result` failed `mypy --strict` with `no-any-return` in every project that type-checks the generated SDK.
