---
'@contractkit/plugin-typescript': patch
---

A `format()` contract no longer loses the fields of its bases. `contract Base: { baseField: string }`
plus `contract format(input=snake) Child: Base & { childField: string }` generated a `Child` schema
with only `child_field`, so a request carrying `base_field` was rejected as an unrecognized key and one
missing it was accepted. The schema was only flattened when the *first* base had a `format()` of its
own, and only through bases in the same file.

A contract whose keys a `format()` renames, its own or a base's, is now always one flat schema with
every base's fields, keyed by that casing, including bases declared in another `.ck` file. A
contract whose second base carried the `format()` also compiled to `A.extend(B.shape)` on a pipe,
which failed to typecheck, and is flattened the same way. The SDK types follow suit: `XOutput`,
`XWireInput` and the response revivers carry the inherited fields in the right casing. External bases
beyond the first are now imported wherever a schema or interface extends them.
