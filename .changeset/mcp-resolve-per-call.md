---
'@contractkit/plugin-typescript': minor
---

A generated MCP tool can resolve its service and policies from the request's container, per call.

A tool constructor-injected its operation's service and `PolicyService` once, when the tool map was built. Tools are singletons, so a request-scoped service (one that reads the caller's actor, say) was resolved outside any request. The new `mcp.resolve: "perCall"` setting emits tools that take no constructor dependencies: `handle()` resolves both from the request's scoped container on the MCP context, as the generated HTTP router does from `ctx.container`. A call made without a container fails with an error naming the fix. The emitted `mcp.router.ts` passes `container: ctx.container` (Koa) or `container: request.container` (Fastify) to `createMcpRequestContext` in this mode. It needs a `@maroonedsoftware/mcp` whose `McpToolContext` carries `container`. The default, `"boot"`, generates tools as before.

`mcp.tools.ts` also exports `registerMcpToolClasses(registry)`, and each tools file exports its own `register<File>McpToolClasses(registry)`, so the tool classes no longer have to be registered by hand.
