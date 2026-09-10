---
'@contractkit/core': minor
---

Add `deriveSdkMethodName(op, route)`, the TypeScript SDK's method-naming rule: `sdk:` verbatim, then
the camelCased `name:`, then the verb and path. The TypeScript SDK generator and the docs' "SDK
method" note both take the name from here now instead of each keeping its own copy, which is how
the docs came to print a name the SDK did not generate.
