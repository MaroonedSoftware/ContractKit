---
'@contractkit/plugin-typescript': patch
---

Coerce temporal response headers to Luxon objects, completing the header table.

When response headers first learned to follow their declared types, temporals mapped to `string` and passed the raw value straight through. Reviving temporal scalars later changed `renderOutputTsType` to produce `DateTime` and `Duration` — so the header *shape* said `DateTime` while the entry still assigned a raw string, and the client file had no `luxon` import at all. A `datetime` response header therefore produced a client that did not compile.

Temporal headers now convert, using the same functions the body reviver does and taking `date` and `time` formats from the contract. This also makes the TypeScript and Python SDKs symmetric: Python has coerced these since its own header types landed.

Two details:

The `luxon` import is decided from the emitted method bodies, like every other import in these files, and is added by both client paths — `generateSdk` for a top-level client and `generateAreaClient` for an area one. Only the first had the reviver's import logic, so an area client needed it separately.

Optional headers assert non-null inside the conversion. TypeScript does not carry the narrowing from `get(x) === null` across a *second* `get(x)` call, so without the assertion the optional form is a `TS2345` even though the ternary has already excluded null. The `bigint` case had the same latent error and is fixed with it — it was invisible because no fixture declared an optional `bigint` header.

Found by running the real CLI over the reference contracts rather than the test harness, which is what that acceptance pass exists for: the fixture had no temporal response header, so nothing in the suite covered the interaction. It does now.
