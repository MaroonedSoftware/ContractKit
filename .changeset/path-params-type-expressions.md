---
'@contractkit/core': minor
---

Path parameters now accept the full type-expression syntax — including constraint args (`int(min=1, max=5)`), enums (`enum(available, pending, sold)`), regex strings, and unions — instead of only a bare type identifier.
