---
'@contractkit/plugin-bruno': minor
---

Sort the Bruno collection alphabetically during codegen.

Top-level folders now order by area name (with subarea as a tiebreaker), and requests within a folder order by request name. The emitted `seq:` numbers — which drive Bruno's UI ordering — line up with that alphabetical sort, regardless of the order the source `.ck` files declare operations.
