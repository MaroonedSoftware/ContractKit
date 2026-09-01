---
'@contractkit/core': patch
---

Warn at build time when an operation declares responses but emits none of them.

The generated router answers such an operation with 204, since a bare status means the service does not produce it. That is the right status, but it is silent: nothing told you that the `400:` you wrote is documentation and that your success path therefore returns an empty 204. The build now says so, with the slug `no-emitted-response`:

```
Operation declares only non-emitted responses (400) — the generated router will return 204.
Add a block to the success status, e.g. '200: { … }' or a bare '204:'.
```

Two details worth recording. The check sits **above** the `if (!op.request) continue` guard, because a bodyless operation is the common case for this warning and skipping it would miss most of what the warning exists to catch. And it is gated on the operation having declared *some* response: an operation with no `response:` block at all has not said anything to be inconsistent about, and warning on those would fire on a large fraction of every codebase.

`validateOp` runs in both the CLI and `validateProject`, so no wiring was needed.
