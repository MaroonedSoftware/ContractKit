---
'@contractkit/plugin-typescript': patch
---

`format()` now applies to a contract with `readonly` or `writeonly` fields. For
`contract format(input=snake) Split: { id: readonly uuid, userName: string }`, both `Split` and
`SplitInput` were plain objects with camelCase keys and no transform, so the server rejected the
`user_name` that the Swift, Kotlin and C# SDKs send for the Input twin. Both schemas now carry the same
key transform a single-schema contract does: `SplitInput` parses the input casing, and `SplitOutput`
is the output casing. Their types follow the single-schema rule, `z.input` when only `format(output=)`
is set and `z.output` otherwise. The TypeScript SDK's `SplitWireInput` now sends the input casing to
match. Response validation already skipped these contracts, since a transformed schema cannot re-parse
its own output.
