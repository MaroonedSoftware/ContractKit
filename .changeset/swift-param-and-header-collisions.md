---
'@contractkit/plugin-swift': patch
---

Fix two naming collisions that made the generated SDK fail to compile.

A path param named after one of the method's own arguments or locals was declared twice: `/notes/{body}` on an operation with a request body gave `putNote(body: String, body: Note)`. A path param now gets a trailing underscore when it lands on `body`, `query`, `customHeaders`, `params`, the `request`, `response` and `headers` locals, or the client's `http` property, so that method takes `body_: String`. Keyword escaping is unchanged (`` `class`: String ``).

An operation that declares both a request `headers:` block and response headers generated two structs named `<Method>Headers` in one module, an invalid redeclaration. The request struct keeps that name, since it is the one a caller constructs, and the response struct becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.
