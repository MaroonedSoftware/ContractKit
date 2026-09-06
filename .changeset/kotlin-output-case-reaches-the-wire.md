---
'@contractkit/plugin-kotlin': patch
---

Fix a contract's `format(input=)` / `format(output=)` being dropped from the generated Kotlin.

The casing renames the keys on the wire without changing the field names the contract declares, and
kotlinx.serialization has no per-class key transform — so the rename has to reach every field as a
`@SerialName`. It reached none: `renderField` derived the wire name from the Kotlin property and
annotated a field only when the contract had already spelled it differently, never consulting
`outputCase` or `inputCase`. `contract format(output=snake) AuthenticationTokenIssued` therefore
generated `val accessToken: String` against a server sending `access_token`, and the first real
response failed to decode with `MissingFieldException` — a report that names the field but says
nothing about the casing that renamed it, in a package whose output had only ever been checked by
compiling it.

The two directions are now read separately, because they describe different halves of a round trip:
a class that decodes a response follows `output`, and an `Input` twin that encodes a request follows
`input`. A model with no Input twin is one class used both ways and can spell only one set of keys,
so a contract setting both directions to different cases is warned about rather than silently
resolved in whichever one happens to render. An anonymous object nested inside a renamed contract is
still hoisted into a class that keeps its own key names — the hoisting pass records no owner to take
the casing from — and that gap is now warned about at the one place the owner is still known.
