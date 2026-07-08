---
'@contractkit/plugin-openapi': patch
---

Emit explicit schemas for the `time` and `interval` scalars instead of type-less (permissive) schemas, and throw on an unmapped scalar type so a missing mapping fails loudly rather than producing an empty schema.
