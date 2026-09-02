---
'@contractkit/plugin-docs': minor
---

Initial release. Generates a deployable Mintlify documentation site from `.ck` files: an OpenAPI
spec, one MDX page per endpoint and per documented model, a `docs.json` navigation file, and a
write-once starter landing page.

Pages carry only frontmatter — Mintlify renders parameters, schemas and the interactive playground
from the spec. `docs.json` is regenerated every build so navigation cannot drift from the contracts;
site settings and hand-written navigation go in the plugin's `docs` option and are merged around the
generated API reference.

The `target` option selects the documentation platform. `mintlify` is the only value today.
