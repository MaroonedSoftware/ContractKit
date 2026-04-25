---
'@maroonedsoftware/contractkit-plugin-typescript': minor
'@maroonedsoftware/contractkit-plugin-markdown': minor
'@maroonedsoftware/contractkit-plugin-openapi': minor
'@maroonedsoftware/contractkit-plugin-python': minor
'@maroonedsoftware/contractkit-plugin-bruno': minor
'@maroonedsoftware/openapi-to-ck': minor
'@maroonedsoftware/prettier-plugin-contractkit': minor
'@maroonedsoftware/contractkit': minor
---

Refactor request handling to support multiple content types in operations. Updated OpRequestNode to accept an array of bodies, modified related functions and tests to accommodate multi-MIME requests, and enhanced validation for nested structures in URL-encoded bodies. Improved code generation across various plugins to handle new request structure.
