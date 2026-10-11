---
'@contractkit/plugin-docs': patch
---

Mark a query or header parameter that has a default as optional. The router fills a defaulted parameter in and the TypeScript SDK already takes it as optional, but the OpenAPI document published it as `required: true` and the Markdown, Mintlify and Docusaurus attribute tables listed it as required.
