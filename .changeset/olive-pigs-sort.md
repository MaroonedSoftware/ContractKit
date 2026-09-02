---
'@contractkit/cli': patch
---

Compile `.ck` files in a deterministic order.

`glob` returns matches in filesystem order, which varies between runs, between machines, and as
files are added or removed. That order reached the plugins as the order of `contractRoots` and
`opRoots`, and every generator walks those in sequence, so a rebuild with no source change could
reorder whole sections of the generated OpenAPI spec, Markdown reference and SDK files. On a
project with 98 contracts, three consecutive builds produced three different documents.

Matches within a pattern are now sorted by code unit, which is locale-independent so a laptop and
CI agree. Patterns keep their configured order and the first pattern to match a file still wins, so
a config listing types before operations keeps that intent.
