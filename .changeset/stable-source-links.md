---
'@contractkit/plugin-typescript': patch
---

Source-link comments in generated TypeScript no longer carry a `#L<line>` anchor. Adding a line near the top of a `.ck` file used to change the comment on every declaration below it, so regeneration churned files whose code hadn't changed. The link now points at the `.ck` file. Contracts and types keep their model name as the link label, and operations and MCP tools name the route after the link, as in ``from [billing.ck](../billing.ck) `GET /payments/{paymentId}` ``.
