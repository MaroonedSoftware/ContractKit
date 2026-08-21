---
'@contractkit/plugin-openapi': patch
---

Carry `name:` and the documented-response marker into the generated spec

OpenAPI has no way to say whether a service produces a status or merely documents it, so the
distinction `.ck` draws was lost on the way out and could not be recovered on the way back in:
a `.ck` → OpenAPI → `.ck` round trip turned every `(documented)` error response into a
service-produced one, silently changing what the generated router and SDKs do.

A response marked `(documented)` now carries `x-contractkit-emit: documented`, which
`@contractkit/openapi-to-ck` honours on import. Vendor extensions are spec-legal and ignored by
other tooling.

An operation's `name:` is now emitted as the OpenAPI `summary`, which it previously omitted
entirely.
