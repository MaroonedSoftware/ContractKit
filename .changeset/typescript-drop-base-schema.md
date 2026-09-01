---
'@contractkit/plugin-typescript': patch
---

Stop emitting the `ModelBase` Zod schema, which nothing has ever read.

A model with writeonly fields emitted three schemas: `ModelBase` with every field, `Model` (read, no writeonly) and `ModelInput` (write, no readonly). Only the last two were exported. `ModelBase` was a plain `const`, and the sole place a `XBase` name was ever *referenced* was inside the block that declares `YBase` for a child model — so `XBase` was read only by `YBase`, and no `YBase` was read by anything reachable. The read schema extends the parent's read schema directly, and the input schema extends the parent's input schema; neither goes through a Base. The construct was a closed island, and under `noUnusedLocals` it is a compile error in the generated file.

Nothing is lost with it. Writeonly inheritance was the thing Base was meant to deliver, and it already rides on the Input chain: a child's `ModelInput` extends its parent's `ModelInput`, which carries the parent's writeonly fields. That is why removing Base changes no exported schema, no inferred type, and no runtime validation.

This supersedes the narrower change of emitting `XBase` only when some writeonly model extends `X`. That predicate turns out to be unsatisfiable in practice: gating the child's Base on having a reader of its own removes the only reference to the parent's Base, so the correct set is always empty.

Visible in diffs but not breaking: an unexported `const` disappears from generated schema files.
