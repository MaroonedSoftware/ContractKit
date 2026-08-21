---
'@contractkit/openapi-to-ck': minor
---

Import 4xx/5xx responses that declare a body as `(documented)`

**This changes the output of re-running the importer.** OpenAPI cannot say whether a handler
*returns* a status or merely documents it, but `.ck` distinguishes the two and every generator
depends on the answer. Every declared status used to be imported as service-produced: a spec
declaring `404: {application/json: Error}` became `404: { … }`, which made the generated Koa
handler responsible for returning the 404 and made the TypeScript and Python SDKs hand it back
as a value rather than throwing.

A bodied 4xx or 5xx now imports as `404(documented): { … }` — the body is the error contract, the
SDK throws it as an `SdkError`, and the service is not responsible for producing it. 2xx and 3xx
are unchanged, as is a bare bodyless error status (marking those would be redundant, and core
warns about it).

Pass `errorResponses: 'emitted'`, or `--error-responses emitted` on the command line, to restore
the previous behaviour.

Also in this release:

- `$ref`s to `#/components/parameters`, `requestBodies`, `responses` and `headers` are now
  resolved. A `$ref`'d parameter previously reached the printer with no name and emitted
  `undefined: string` — which parses, so nothing reported it. Anything still unresolvable is
  warned about and skipped instead of emitted.
- Every generated file is re-parsed before it is returned, and a file that does not parse is
  reported as a warning rather than written out silently.
- The command line gained `--no-comments`, which was documented but never implemented.
