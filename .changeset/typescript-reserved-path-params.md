---
'@contractkit/plugin-typescript': patch
---

Rename a path param whose name cannot be bound in generated TypeScript, so a route like `/seats/{class}` no longer produces an SDK client and routers that fail to parse.

The SDK spread the param into the method signature under its declared name, so `class` gave `async getSeat(class: string)` (TS1390) and a cascade of parse errors through the whole client file. The Koa and Fastify routers destructured it the same way (`const { class } = ...`), and so did the MCP tool handler. Each now binds a JavaScript reserved word under a trailing underscore (`class_`), the way the routers already renamed a param that collided with a handler local. The route placeholder, the router's params schema key and the MCP tool's argument name keep the declared spelling.

A path param also can no longer take a name the SDK method already uses: `body`, `query`, `customHeaders`, `options` or `params` (a duplicate argument, as in `putNote(body: string, body: Note)`), a local such as `result` or `qs`, or a function the method calls, such as `encodeURIComponent`. Those get the same underscore. The argument is positional, so callers are unaffected.

In an MCP tool, a path param named `body`, `query` or `headers` shared the flat args object with the argument of that name, and the generated schema declared the key twice. The path param's key is now `body_`.
