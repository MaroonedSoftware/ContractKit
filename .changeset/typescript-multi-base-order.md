---
'@contractkit/plugin-typescript': patch
---

A contract with several bases is now declared after all of them, not only the first. `C: A & B`
generates `A.extend(B.shape)`, which reads `B` when the module loads, but the model sort only
counted `A` as a dependency. When `B` itself waited on a later model, `C` could be emitted ahead of
it and the module threw at import.
