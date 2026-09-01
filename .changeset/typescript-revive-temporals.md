---
'@contractkit/plugin-typescript': minor
---

Revive temporal scalars in generated SDK clients, so a `datetime` field really is a Luxon `DateTime`.

In `sdk: { zod: true }` mode a `datetime` field's type comes from `z.infer` over `z.custom<DateTime>`, so the SDK has always *claimed* to return a `DateTime`. The client reads its response with `JSON.parse` and a cast, and never runs the schema — so at runtime the field held a string, and `order.shipDate.toISO()` threw. The same held for `date`, `time` and `duration`.

The generated `reviveX` functions now rehydrate those scalars alongside `decimal`, using helpers that mirror what the schema validates against:

- `datetime` → `DateTime.fromISO`
- `duration` → `Duration.fromISO`
- `date` and `time` → `DateTime.fromFormat` with the format from the contract, defaulting to `yyyy-MM-dd` and `HH:mm:ss`

Each throws a `TypeError` naming the field path rather than returning something invalid, since a silently wrong `DateTime` surfaces much further from its cause than a throw at the boundary does. A file gets only the helpers its revivers call, decided by scanning the emitted text — the idiom the reviver and type imports already use, for the same reason: a separately computed predicate can drift and leave an unused local behind.

`interval` is deliberately excluded. `_ZodInterval` ends in `.transform(v => v.toISO()!)`, so its inferred output type is already `string` and there is nothing to revive it to. Covering it means making that round-trip idempotent first, which the router's `isRevalidatable` also depends on.

Two things ride along:

**Plain types now say `DateTime` too.** `renderTsScalar` mapped every temporal to `string` for both targets, so `types:` output disagreed with what the router and the SDK actually hand you. It now renders the Luxon classes, and the emitted file imports them.

**`_ZodBinary` follows the render target.** It was `z.custom<Buffer>` unconditionally, and SDK type files reach it through the same `generateContract`, so a browser client got `Buffer.isBuffer` with no `@types/node` in its scaffold — the type did not resolve and the check could not run. The SDK's schemas are now client-shaped (`Blob`), matching what `renderTsScalar` has always said for that target; the server and standalone `zod:` outputs are unchanged.

No bump to `TYPESCRIPT_CODEGEN_VERSION` is needed; it was already raised to `2` earlier in this batch. Cache invalidation for the wider taint set comes for free: every `hashFingerprint` that slices it already exists, so a model gaining a `datetime` in another `.ck` file invalidates dependent output as it should.
