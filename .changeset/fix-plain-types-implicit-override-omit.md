---
'@contractkit/plugin-typescript': patch
---

Fix plain TypeScript codegen producing invalid `extends` clauses when a child contract redeclares an inherited field without the explicit `override` keyword (e.g. narrowing `kind: BusinessRoleKind` to `kind: 'employee'`). The base is now wrapped in `Omit<Base, 'fieldName'>` for any redeclared field, matching the behaviour for explicit `override` fields.
