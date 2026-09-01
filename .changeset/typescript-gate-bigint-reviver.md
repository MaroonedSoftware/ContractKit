---
'@contractkit/plugin-typescript': minor
---

Apply the bigint JSON reviver only to contracts that actually declare a `bigint`.

`parseJson` ran every response through `bigIntReviver`, which tests `/^-?\d+n$/` against every string anywhere in the document. A contract with no `bigint` field still had a legitimate value like `"123n"` — a product code, a hash fragment, a user's own text — silently turned into a `BigInt`, at any depth, in any field.

The shared runtime now exports two functions. Clients whose responses carry a `bigint` import `parseJsonWithBigInt` aliased to `parseJson`, so the method bodies are identical either way and the import line is where the choice is legible.

The predicate is transitive and cross-file, because a `bigint` reached through a referenced model still arrives on the wire as `123n`. It comes from a `modelsWithBigInt` taint set computed the same way `modelsWithDecimal` is, and sliced into the same per-file fingerprints — so a model gaining a `bigint` in another `.ck` file invalidates the clients that read it, rather than leaving a cached client with the wrong import.

A full schema-driven revival was considered and rejected: `bigIntReplacer` serialises bigints at any depth on the way out, so a path-aware reviver would have to cover exactly the same paths to stay symmetric. Gating the whole reviver on a contract-level predicate takes almost all of the benefit for a fraction of the machinery.

Renamed `sdkNeedsBigIntReviver` to `sdkParsesJsonResponse` along the way. It tests whether an operation reads a JSON response body at all, which is now the gate for importing `parseJson` in either form — and is a different question from whether the reviver is needed.

### What this breaks

A response field holding the string `"123n"` now stays a string, unless the contract declares that field as `bigint`. If you were relying on the conversion, declare the field `bigint` and it comes back.
