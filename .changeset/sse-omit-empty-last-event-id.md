---
'@contractkit/plugin-typescript': patch
---

`sseRequestHeaders` no longer sends an empty `Last-Event-ID` header. A stream whose last event carried an empty `id:` clears `lastEventId` to `''`, and passing that back used to send the header with no value; EventSource omits the header in that case, and a server may reject or misread an empty cursor.
