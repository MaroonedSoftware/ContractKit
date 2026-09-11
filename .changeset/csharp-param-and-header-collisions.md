---
'@contractkit/plugin-csharp': patch
---

Fix two naming collisions that made the generated SDK fail to compile.

A path param named after one of the method's own arguments or locals was declared twice: `/notes/{body}` on an operation with a request body gave `PutNoteAsync(string body, Note body, ...)`, error CS0100. A path param now gets a trailing underscore when it lands on `body`, `query`, `customHeaders`, `pathParams`, `cancellationToken`, the `response` and `headers` locals, or the client's `http` field, so that method takes `string body_`. Keyword escaping is unchanged (`string @class`). The pattern variable an optional response header is read into is renamed the same way, so a header named like a parameter no longer redeclares it (CS0136).

An operation that declares both a request `headers:` block and response headers generated two records named `<Method>Headers` in one namespace, error CS0101. The request record keeps that name, since it is the one a caller constructs, and the response record becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.
