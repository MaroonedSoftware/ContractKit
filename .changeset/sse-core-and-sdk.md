---
'@contractkit/core': minor
'@contractkit/plugin-typescript': minor
'@contractkit/plugin-python': patch
'@contractkit/plugin-kotlin': patch
'@contractkit/plugin-swift': patch
'@contractkit/plugin-csharp': patch
---

Support Server-Sent Events responses. A `text/event-stream` body is now its own `event-stream` content-type category, checked before the `text/` rule, and its declared type is the schema of each event's JSON `data`. `validateOp` errors when a stream is not the only body of a 2xx status, when the operation has another non-error outcome, when the event type is `binary`, or when a request body uses `text/event-stream`. `eventStreamResponse(op)` and `eventStreamOperations(root)` find streaming operations for generators.

The TypeScript SDK method for a streaming operation returns `Promise<SseEventStream<Event>>`, an async iterable of parsed events with `lastEventId` for resuming, and takes optional `requestOptions: { signal?, lastEventId? }`. It goes through the existing `SdkFetch`, so custom fetch, auth headers and the `SdkError` path are unchanged, and parses frames with the new `parseSse` helper in `sdk-options.ts`, applying the same revivers a buffered body gets.

The Python, Kotlin, Swift and C# SDKs do not stream: they warn on a streaming operation and keep reading the response as one string.
