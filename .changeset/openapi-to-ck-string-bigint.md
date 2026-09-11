---
'@contractkit/openapi-to-ck': patch
---

Import `type: string, format: bigint` as `bigint`. This is the form the `@contractkit/plugin-docs` OpenAPI target now documents a `bigint` as, because every ContractKit client sends one as a digit string rather than a JSON number. Its `pattern` is implied by the scalar, so it is not imported as a `regex=` modifier, and its bounds come back as exact values from `x-contractkit-min` / `x-contractkit-max`, the extensions `decimal` already uses. A digit-string `default` on such a property becomes the bare number a `.ck` source writes (`= 5`), so a round trip through the OpenAPI output is stable.

`type: integer, format: int64` still imports as `bigint`, as before.
