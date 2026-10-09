---
'@contractkit/plugin-docs': minor
---

Make the OpenAPI document importable by client generators and connector builders. Every `operationId` is now unique (one that collides falls back to the SDK method name, then a number), and operations with neither `sdk:` nor a service now get one; `operationIds: 'sdk'` names them all as the TypeScript SDK does. A model used as a whole query or header source becomes one parameter per field, bases included and named in the model's `format(input=)` casing, instead of a single object-typed parameter.
