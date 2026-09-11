---
'@contractkit/plugin-typescript': patch
---

Two contracts that refer to each other, one of them through `lazy()`, now load in the right order.
`Folder { readme?: Doc }` with `Doc { folder?: lazy(Folder) }` put `Folder` first, so the generated
module evaluated `Doc.optional()` before `Doc` was declared and threw at import. The model sort
counted the lazy reference as a dependency, saw a cycle, and fell back to source order. A lazy
reference is read only when a value is parsed, so it no longer constrains the order.
