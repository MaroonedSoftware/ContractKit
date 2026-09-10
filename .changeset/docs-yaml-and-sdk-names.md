---
'@contractkit/plugin-docs': patch
---

Four fixes found by running the docs targets against a real project's 125 contracts.

The OpenAPI document is valid YAML again, which on that project it was not: 419 parser errors from
two causes, both inherited by the Mintlify target, which renders from that spec.

- A description spanning several lines was single-quoted with its line breaks written raw, so the
  next line started at column 0. A string carrying a line break or another control character is
  now written as a double-quoted scalar, which stays on one line and keeps the break.
- An empty object value, such as the `additionalProperties: {}` a `record(any)` produces, was
  treated as a nested block and written on the line after its key with no indentation. It is now
  written inline, as an empty array already was.

The "SDK method" note on the Markdown and Docusaurus pages now names the method the TypeScript SDK
actually generates. It skipped the `name:` step of the SDK's naming priority
(`sdk:`, then `name:`, then verb and path), so an operation named `Request token` was documented as
`postAuthToken` while the SDK exposes `requestToken`.

Security stated once in a file's `options` block now reaches the documentation. Every target
resolved an operation's security from the operation and its route but never the file, which the
routers do honour, so a contract that sets its floor once, the pattern the language recommends,
had most of its operations documented with no security at all (97 of 172 endpoint pages on that
project), and a file-wide `security: none` was not marked public in the OpenAPI document.
