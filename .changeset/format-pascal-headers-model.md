---
'@contractkit/plugin-typescript': patch
---

A router now finds the headers of a `format(input=pascal)` model referenced as a `headers:` block.

Node lowercases every incoming header name, so a router copies each declared header that is not lowercase over from its lowercase key before validating. For a `format()` model it copied none, but a `format(input=pascal)` model's object is keyed `TenantId`, which the request never carries, so every such header was missing. The router now copies each key the model's object parses, `{ ...ctx.headers, TenantId: ctx.headers['tenantid'] }`, as it already did for a model without `format()`. A `format(input=snake)` model's keys are lowercase and still read straight off the request.
