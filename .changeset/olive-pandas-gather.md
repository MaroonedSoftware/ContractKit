---
'@contractkit/plugin-docs': minor
---

Split the Models navigation group by area. Models from a contract file declaring an `area` now
become a nested subgroup inside `Models` and are written to `<modelsDir>/<area>/`, matching how
endpoint pages are already grouped. Models from files with no area stay directly in `Models`, so a
project that declares no areas keeps the flat list it had before.

A large API put every schema in one flat sidebar section, which was unusable past a few dozen
entries. Schema names now only have to be unique within their own area.
