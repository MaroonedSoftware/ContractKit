---
'@contractkit/plugin-swift': patch
---

The generated Swift is now compiled and run in the test suite, and the README no longer says it
has never been built.

Two tests build a generated package with a real Swift toolchain, in Swift 6 language mode with
complete concurrency checking and warnings as errors. One covers the shared cross-plugin fixtures.
The other covers a contract holding every construct the generator branches on: both union forms,
self and mutual recursion, tuples, records, every scalar, `format()` key casing, flattened
inheritance with readonly and writeonly fields, keyword field and method names, multipart
requests, and multi-status, multi-content-type responses. It then runs a probe of 57 checks that
decode, encode and round-trip through the generated types and drive the generated client over a
mock transport, because a compile cannot see a struct that builds and then fails to decode.

The first build found nothing to fix. The generated code itself is unchanged. Both tests skip when
`swift` is not installed.
