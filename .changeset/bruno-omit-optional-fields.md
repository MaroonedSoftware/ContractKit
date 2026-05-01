---
'@contractkit/plugin-bruno': minor
---

Omit optional fields from generated request body skeletons instead of emitting them as `null`.

Previously, an optional field with no default produced `"nickname": null` in the example JSON body. The field is now absent so the example body sends only what the contract actually requires, matching how most APIs treat "omit" vs. "explicit null".
