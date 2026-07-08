---
'@contractkit/plugin-markdown': patch
---

Escape newlines in table cells (as `<br>`) so multi-line descriptions no longer corrupt the generated tables. Render the `interval` and `time` scalars as `string` instead of `unknown`, and throw on an unmapped scalar type.
