---
'@contractkit/core': patch
'@contractkit/plugin-typescript': patch
'@contractkit/plugin-python': patch
'@contractkit/plugin-docs': patch
---

Derive a valid SDK method name from any `name:` value. `name:` is free text, so `name: Generate C# client` used to emit `generateC#Client`, which does not compile. The TypeScript SDK and the docs' SDK method note now treat characters an identifier cannot hold as word breaks (`generateCClient`), prefix a leading digit with `_` (`_2faSetup`), and use the verb and path when nothing usable remains. The Python SDK and the MCP tool classes get the same leading-digit and empty-name handling. Two forms that happened to compile are renamed: a quoted name (`name: "Get User"` was the method `GetUser`, now `getUser`) and an all-digit name (`name: 123` is now `_123`). Every other name that compiled before keeps its method name.
