---
'@contractkit/plugin-typescript': minor
---

Fix `ref & ref` type alias intersections generating `ZodIntersection` instead of `ZodObject`

Contracts like `contract Foo: A & B` (two model refs, no inline fields) previously emitted `A.and(B)`, producing a `ZodIntersection`. This broke `.strict()` calls on the result and caused each strict schema to reject the other's keys at runtime.

All three rendering paths (`renderIntersection`, `renderInputType`, `renderQueryType`) now emit `.extend(B.shape)` chains for any `ref & (ref | inlineObject)*` intersection, matching the pattern already used for multi-base model inheritance.
