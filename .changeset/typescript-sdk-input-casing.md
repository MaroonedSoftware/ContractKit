---
'@contractkit/plugin-typescript': patch
---

An SDK request that carries a `format(input=…)` contract now reaches the server in the casing the
server parses. For `contract format(input=pascal, output=snake) Token`, `mint(body: Token)` asked the
caller for `access_token`, the post-transform shape, and sent it unchanged. The server's schema only
accepts `AccessToken`, so every such request failed validation. The same happened with a
`format(input=snake)` contract, which the SDK sent in camelCase, and with any contract nesting one.

SDK type files now declare a `TokenWireInput` interface with the keys the server parses, at every
level, and request bodies, query objects and header objects are typed with it. Responses keep
`TokenOutput`. In a Zod SDK this also fixes a plain contract nesting a `format(output=…)` one, whose
nested keys were typed in the output casing. Server types are unchanged.
