---
'@contractkit/prettier-plugin': patch
---

Preserve trailing comments instead of dropping them on format: a comment as the last line of a contract/model body, an operation/route body, an inline object type, or an options `keys`/`services` block now round-trips.
