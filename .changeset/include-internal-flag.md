---
'@maroonedsoftware/contractkit-plugin-typescript': minor
'@maroonedsoftware/contractkit-plugin-python': minor
'@maroonedsoftware/contractkit-plugin-openapi': minor
'@maroonedsoftware/contractkit-plugin-markdown': minor
'@maroonedsoftware/contractkit-plugin-bruno': minor
---

Add an `includeInternal: boolean` config option to every plugin so consumers can override whether `internal` operations are emitted. Defaults preserve today's behavior: server router and Bruno default to `true` (include); TS SDK, Python SDK, OpenAPI, and Markdown default to `false` (exclude).
