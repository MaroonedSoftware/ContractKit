---
'@contractkit/core': minor
'@contractkit/prettier-plugin': patch
---

`signature:` inside a `security` block is now an error that points at the operation-level `signature:` field. It used to parse and do nothing, so the request went unverified and formatting deleted the line. The prettier plugin now refuses to format any file with a parse error instead of printing what survived, which for a syntax error was an empty file.
