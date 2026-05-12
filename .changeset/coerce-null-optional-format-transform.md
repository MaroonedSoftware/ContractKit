---
'@contractkit/plugin-typescript': patch
---

Coerce `null` to `undefined` for optional fields in model-level `format(input=...)` / `format(output=...)` transforms, matching the existing behavior for inline objects.
