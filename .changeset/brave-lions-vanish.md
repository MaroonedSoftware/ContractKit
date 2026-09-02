---
'@contractkit/plugin-docs': patch
---

Removed the deprecated `@contractkit/plugin-openapi` and `@contractkit/plugin-markdown` packages
from the workspace. Both shipped a final 1.0.0 that re-exported the corresponding plugin-docs target
and carried a migration note, so anyone still on them keeps working on that version; there will be
no further releases of either.

Documentation that described them as separate plugins now documents `openapi` and `markdown` as
targets of `@contractkit/plugin-docs`, including their full option tables.
