---
'@contractkit/core': patch
---

An operation's doc comment written at the top of its body, on the lines below `get: {`, keeps every line. It used to keep only the first, so a three-line description reached the SDK and the OpenAPI document cut off mid-sentence, and `pnpm format` moved that first line up onto the brace. A comment on the brace line itself is still the inline form.
