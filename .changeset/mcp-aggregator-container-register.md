---
'@contractkit/plugin-typescript': patch
---

Stop the MCP aggregator from calling `container.register`, and underscore the unused `args` parameter on no-argument tools.

`generateMcpAggregator` emitted `container.register(McpToolHandlerMap, { useValue: map })`. InjectKit's `Container` has no `register`; it exposes only `get`, `createScopedContainer`, `hasRegistration`, `disposeAsync`, and `[Symbol.asyncDispose]`. Registration belongs to `Registry`, the composition-phase object, while `Container` is the resolution-phase one. Every generated `mcp.tools.ts` therefore failed to compile with `TS2339`, and would have thrown at startup if it had.

`registerMcpTools` now only builds the map and returns it. Its doc comment shows the binding that supplies the `Container` in the first place:

```ts
registry.register(McpToolHandlerMap).useFactory(registerMcpTools).asSingleton();
```

`generateMcpRouter`'s doc line told consumers to _call_ the aggregator at startup, which is the same mistake. It now points at the binding.

Separately, `renderToolClass` always named the handler's first parameter `args`. An operation with no path parameters and no request body destructures nothing, so the parameter went unread and tripped `@typescript-eslint/no-unused-vars` in consumers that lint generated output. It is now emitted as `_args` when there is nothing to destructure.
