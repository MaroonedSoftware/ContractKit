---
'@contractkit/plugin-typescript': patch
---

The generated SDK's default `X-Request-ID` now works in a browser page served over plain HTTP.

`createSdkFetch` defaulted `requestIdFactory` to `crypto.randomUUID()`, which a browser defines only in a secure context (HTTPS or localhost). An app served over plain HTTP from a LAN address, such as `http://192.168.1.10:8080`, has it undefined, so every SDK request threw `TypeError: crypto.randomUUID is not a function` before `fetch` ran. The default is now a small helper emitted in `sdk-options.ts` (and in the inline fallback when there is no shared file): it still uses `crypto.randomUUID` where it exists, and otherwise builds an RFC 9562 version 4 UUID from `crypto.getRandomValues`, which has no secure-context restriction. A `requestIdFactory` passed in the options is used as before, so an app that worked around this with its own factory can drop it.
