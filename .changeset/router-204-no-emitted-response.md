---
'@contractkit/plugin-typescript': minor
---

Return 204 when an operation emits no response, instead of an error status.

The generated router picked its status as `emitted ?? first declared ?? 200`. For an operation whose response block is documentation only, the first declared status is an error code, so the router answered a *successful* request with it:

```
delete: {
    response: {
        400:
    }
}
```

emitted `ctx.status = 400` on the success path. A bare status means "documented, produced by something else" — middleware, a proxy, the framework — so it is precisely the status the service does not produce, and the worst possible choice of fallback.

204 is the status that aligns the three generators. `observableResponses` excludes a bare `400:` for the same reason `emittedResponses` does, so the SDK already types such a method `Promise<void>` and `thrownResponses` already puts the 400 in `@throws`. A bodyless 204 success is exactly what `Promise<void>` means; the router was the only one disagreeing.

### What this breaks

**Operations declaring only non-2xx statuses now return 204 rather than that status.** The old behaviour was an error code returned on success, so any client treating it as an error was correct to and now gets a success it can act on. If you genuinely want that status written, give it a block — `400: { … }` — which makes it service-produced and restores it.

An operation with no `response:` block at all also moves from 200 to 204, on the same reasoning: it emits nothing, and 204 says so precisely. Both are 2xx, so nothing that checks for success changes behaviour; a client asserting `status === 200` would need updating.
