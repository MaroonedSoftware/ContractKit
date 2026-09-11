---
'@contractkit/core': minor
'@contractkit/plugin-typescript': patch
'@contractkit/plugin-kotlin': patch
'@contractkit/plugin-swift': patch
'@contractkit/plugin-csharp': patch
'@contractkit/plugin-bruno': patch
'@contractkit/plugin-docs': patch
'@contractkit/openapi-to-ck': patch
'contractkit-vscode-extension': patch
---

A default on a `bigint` field is parsed as an exact `bigint`, and the generated TypeScript for one compiles.

`quantity: bigint = 9007199254740993` used to parse to the JS number `9007199254740992`, so every generator emitted the rounded value and `pnpm format` wrote it back into the file. The parser now reads the literal's digits into a `bigint`, for a `bigint` field or a `bigint | null` one. A non-integer default such as `= 1.5` is reported as an error instead. `FieldNode.default` and `OpParamNode.default` are typed `FieldDefault`, which adds `bigint`, so plugins that read a default have one more case to handle. The new `coerceDefault` export applies the rule.

The TypeScript plugin wrote a bigint default as `.default(5)`. Zod requires a default to be the schema's output type, so every generated project with a bigint default failed to typecheck (TS2769). At runtime the handler would also have received a `number`, because Zod returns a default without parsing it. It now writes `.default(5n)`.

Every other consumer handles the new value: Kotlin, Swift and C# initialize from the exact digits, Bruno and the `openapi` target write the digit string a `bigint` travels as, `openapi-to-ck` reads that string back with `BigInt()` rather than `Number()`, and the VS Code hover no longer throws when a referenced model carries a bigint default.

A default on a field whose type is a `ref` to a `bigint` alias is still parsed as a number, because the alias is not resolved at parse time.
