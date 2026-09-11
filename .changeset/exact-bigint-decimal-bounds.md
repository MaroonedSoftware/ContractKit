---
'@contractkit/core': patch
---

`bigint` and `decimal` bounds keep the digits the source wrote.

The parser turned every number literal into a JS `number` before the scalar saw it, so `bigint(max=9007199254740993)` parsed to `9007199254740992n`, and `decimal(min=0.10, max=123456789012345678901.5)` to `'0.1'` and `'123456789012345680000'`. Every generator then enforced the rounded bound, and `pnpm format` wrote it back into the file. Both scalars now read the literal's source text.

A `bigint` bound that is not an integer, such as `bigint(min=1.5)`, used to throw a `RangeError` out of the parser. It is now reported as an error diagnostic on its line, and the bound is dropped.
