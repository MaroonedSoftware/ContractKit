---
'@contractkit/openapi-to-ck': patch
---

Flatten multi-line descriptions into single-line trailing comments and quote enum values containing spaces or other non-identifier characters, so `.ck` generated from real-world OpenAPI specs re-parses cleanly.
