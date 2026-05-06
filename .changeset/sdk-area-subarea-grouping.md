---
'@contractkit/plugin-typescript': minor
---

Group TypeScript SDK clients by `keys.area` and `keys.subarea`. Files declaring `subarea` produce a leaf `<Area><Subarea>Client` exposed at `sdk.<area>.<subarea>`; area-only files (no subarea) inline their methods directly onto a synthesized `<Area>Client` and surface as `sdk.<area>.<method>`. Files with no area keep the legacy flat `sdk.<filename>` shape.

`{subarea}` is a new path-template variable on `output.clients` and `output.types`, enabling layouts like `src/{area}/{subarea}.client.ts`. Multiple area-level files merging into one client throw a codegen-time error if any method names collide — disambiguate with `sdk:` or move into a subarea.

Breaking: area-level files no longer emit a standalone `*.client.ts` (their methods live on the area client in `sdk.ts`). The `generateSdkAggregator` signature now takes a structured `SdkAggregatorInput` rather than `(clients, importPath?, className?)`.
