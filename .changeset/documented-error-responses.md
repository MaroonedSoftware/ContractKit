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

Coverage, in the same release:

- `name:` is imported from an operation's `summary`, which used to be dropped entirely.
- Request bodies keep any RFC 6838 `type/subtype` content type. The importer previously allowed
  only JSON, form-urlencoded and multipart, silently discarding everything else, even though the
  grammar has accepted any mime since vendor MIME support landed.
- `format: duration` maps to the `duration` scalar, and the `idn-email`, `uri-reference`, `iri`
  and `iri-reference` formats map alongside their existing counterparts.
- `additionalProperties: true` imports as `mode(loose)`.
- A spec-level `security` requirement now applies to operations that do not override it; it was
  collected and never read, so a globally unsecured spec imported as secured.
- Constructs with no `.ck` equivalent are warned about rather than dropped in silence: `head`,
  `options` and `trace` operations, non-numeric response keys (`default`, `4XX`), cookie
  parameters, unparameterised mime types, and the `exclusiveMinimum`, `exclusiveMaximum`,
  `multipleOf` and `uniqueItems` constraints. A `4XX` response key previously became status `4`,
  because `parseInt` stops at the first non-digit.
