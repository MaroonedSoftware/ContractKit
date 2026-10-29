---
'@contractkit/plugin-typescript': patch
---

`parseSse` now publishes an event's `id` as `lastEventId` only when that event is dispatched, as the EventSource spec does. Before, a stream that ended after an `id:` line but before the event's blank line dropped the event yet still advanced `lastEventId`, so a client resuming from it told the server it had an event it never received. The id still carries over to later events that have none of their own.
