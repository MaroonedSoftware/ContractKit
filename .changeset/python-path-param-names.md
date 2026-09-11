---
'@contractkit/plugin-python': patch
---

Keep a path param clear of the names its method already uses.

A path param becomes an argument of the generated method, next to `self`, `body`, `query` and `custom_headers`, and its value is interpolated through `quote(str(...))`. A path param named `body` on an operation with a request body generated two `body` parameters, a duplicate-argument `SyntaxError` that stopped the whole module importing; one named `quote` or `str` shadowed the function the URL expression calls, and failed when the method ran. Such a param now gets a trailing underscore (`body_`), in the signature and the URL alike.
