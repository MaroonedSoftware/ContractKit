---
'@contractkit/core': minor
---

Preserve trailing comments and options-block (`keys`/`services`) comments through the formatter via new `trailingComments`/`optionsComments` AST fields; make options-level header defaulting idempotent (re-validating an already-merged AST no longer emits spurious override warnings); detect cross-base inheritance conflicts that flow through type-alias bases; and surface unexpected parse-time exceptions as diagnostics instead of silently dropping the file.
