---
'@contractkit/plugin-typescript': minor
---

Move `<Area>Client` classes out of `sdk.ts` and into their own `<area>.client.ts` files. Previously the SDK aggregator declared the `<Area>Client` class inline and merged area-level methods into it; now the merged class is emitted to a synthesized `<area>.client.ts` next to its leaf subarea clients, and `sdk.ts` only imports it. The aggregator is now a thin file: imports + a `Sdk` class with property wiring.

The area-client output path is derived from the same `output.clients` template as leaf clients via the new `computeSdkAreaClientOutPath` helper — `{filename}` and `{area}` substitute to the area name, `{subarea}` to empty (with double-slashes collapsed and any hidden `.client.ts` segment fixed up). For typical templates like `src/{area}/{subarea}.client.ts` or `src/{area}/{filename}.client.ts`, this produces `src/<area>/<area>.client.ts`.

`generateSdkAggregator`'s `SdkAreaInfo` shape changed: `inlineFiles` and `subareaClients` are gone — the aggregator now takes a single `client: SdkClientInfo` per area pointing at the new file. Plugins / tooling consuming `generateSdkAggregator` directly need to update. The new `generateAreaClient` function takes the inline-file list + subarea clients and returns the `<area>.client.ts` content. Per-area cache units mean a change to one file's ops only re-renders that area's client.

Consumers who imported an `<Area>Client` type directly from `sdk.ts` need to import from `./<area>/<area>.client.ts` (or `./<area>/<area>.js` after compile) instead — `Sdk` and `SdkOptions` continue to come from `sdk.ts`.
