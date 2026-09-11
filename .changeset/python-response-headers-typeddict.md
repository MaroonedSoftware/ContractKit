---
'@contractkit/plugin-python': patch
---

Give an operation's response-headers `TypedDict` its own name when the operation also declares request headers.

Both were named `<Method>Headers`. Python accepts the second definition without complaint and keeps it, so the method's return type pointed at the request headers, and a type checker checked the returned headers against the wrong keys. The request `TypedDict` keeps `<Method>Headers`, since it is the one a caller builds, and the response one becomes `<Method>ResponseHeaders`. Operations declaring only one of the two are unchanged.
