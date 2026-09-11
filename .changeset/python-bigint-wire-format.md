---
'@contractkit/plugin-python': minor
---

Send and read `bigint` the way the other ContractKit clients do: as a digit string.

`bigint` mapped to a bare `int`, so `model_dump(mode="json")` put a JSON number on the wire. A ContractKit server's schema for a bigint only accepts a string (`"123"`, or the TypeScript SDK's `"123n"`), so every request carrying one was rejected with "expected bigint, received number". A JSON number also loses precision past 2\*\*53, which is the reason the contract said bigint. On the way in, a `"123n"` failed validation against `int`.

A new `_scalars.py` defines `BigInt`, an `int` annotated to read a digit string, a `"123n"` string or a JSON number, and to write a plain digit string in JSON mode. Every `bigint` in a model, request body, query param or response now uses it. That matches what the Kotlin, Swift and C# SDKs write, and the server accepts it. In Python the value is still an `int`, and `model_dump()` in Python mode still returns one.

**Minor rather than patch, because the wire format changes.** Against a ContractKit server nothing that worked stops working, since the number was always rejected. A server built from an OpenAPI spec generated before this release, which documented bigint as `type: integer`, now receives a string; the spec itself now documents the digit string.

No bump to `PYTHON_CODEGEN_VERSION` is needed; it was already raised to `3` earlier in this batch.
