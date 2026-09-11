---
'@contractkit/plugin-typescript': patch
---

A recursive contract now has a real TypeScript type instead of `any`. A field such as
`parent?: lazy(Folder)` was generated as `parent: z.lazy(() => Folder).optional()` inside `Folder`'s own
initializer. TypeScript cannot infer a type from itself, so `Folder`, its `z.infer` type and its
reviver all became `any`, and a strict build failed with TS7022. Every object field whose type contains
`lazy()` is now a getter that names the schema directly, such as
`get parent() { return Folder.optional(); }`, which Zod 4 supports and TypeScript can infer through.
Parsing behaves as before.
