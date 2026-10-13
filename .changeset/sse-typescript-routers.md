---
'@contractkit/plugin-typescript': minor
---

Generate Server-Sent Events routes. For a `text/event-stream` operation the Koa and Fastify routers hand the service a typed `EventSink<Event>` (`send`, `onClose`, `closed`, `signal`) and the client's resume point from `resolveLastEventId`, instead of writing a returned body. The response opens on the service's first use of the sink, so the service can still throw an error status first, and ends when the service method settles. Each router with a stream exports the `EventSink` type.

`ServerFramework` gains `response.openSse()`, `request.lastEventId` and `streamSetup()`. On Fastify the stream is ServerKit's `openSseReply`, the route carries `config: { contractkit: { stream: true } }`, and the plugin aborts its streams from a `preClose` hook so shutdown drains them. On Koa it is `openSseStream`. MCP skips streaming operations, and warns when one is marked `mcp`.
