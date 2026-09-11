---
'@contractkit/plugin-typescript': patch
---

Import `DateTime`, `Duration` and `Decimal` into an SDK client whenever its code names them, so a `date` query param no longer produces a client that fails with TS2304 "Cannot find name 'DateTime'".

A client's luxon import was decided from response-header conversions alone (`DateTime.fromISO(...)`), and its decimal.js import from the reviver prelude alone. A query, header or path param typed `date`, `datetime`, `duration` or `decimal`, or an inline response or error body holding one, named the class in the method signature without importing it. Both imports are now read off everything the client file emits, in top-level and area clients alike.
