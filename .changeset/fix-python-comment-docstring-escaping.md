---
'@contractkit/plugin-python': patch
---

Split multi-line descriptions across `#` comment lines and escape `"""` in generated method docstrings so ordinary multi-line doc comments can no longer produce invalid Python. Render the `interval` scalar as `str` and throw on an unmapped scalar type instead of falling back to `Any`.
