---
'@contractkit/plugin-typescript': patch
---

Stop importing model types into SDK clients that never mention them.

`collectTypes` walks the AST and reports every model a request body names, regardless of its content type. `buildMethodParams` types a `multipart/form-data` body as `FormData`, so that model is never mentioned in the emitted method and its import is left unused, which is a compile error under `noUnusedLocals`. The same happened to a model's read variant when only its `Input` variant was actually referenced.

The collected list is now filtered against the emitted text before imports are generated: the method bodies, the error-body aliases and the inline reviver declarations. This is the idiom the reviver imports in the same function already use, and it errs toward keeping — a name appearing only inside a doc string counts as a reference, because a surplus import is untidy while a missing one does not compile.

Multipart is deliberately not special-cased inside `collectTypes`. Validating multipart bodies against their declared contract is work still to come, and it would have to undo that special case; with a text-derived filter the model becomes referenced on its own the moment the body is checked, and the import comes back automatically.

The aggregator path, which calls `collectTypes` separately when several op files merge into one area client, gets the same filter.

Visible in diffs but not breaking: an `import type` shrinks or disappears. Nothing exported changes.
