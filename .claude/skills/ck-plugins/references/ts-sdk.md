# TypeScript SDK codegen

Entry points are `generateAreaClient` and `generateSdkAggregator` in
`packages/plugin-typescript/src/codegen-sdk.ts`.

## Subclient grouping

`keys.area` and `keys.subarea` cluster operations on the generated SDK:

- **area + subarea** — the file emits a leaf `<Area><Subarea>Client` at `output.clients`
  (the path template can use `{subarea}`); the area's `<Area>Client` wires it as
  `sdk.<area>.<subarea>`.
- **area only** — the file does **not** emit a standalone `*.client.ts`. Its methods merge
  into the area's synthesized `<Area>Client` (emitted to `<area>.client.ts` next to the
  leaves), surfacing as `sdk.<area>.<method>`.
- **neither** — legacy flat shape: a per-file `<Filename>Client` exposed as `sdk.<filename>`.

Every area gets its own `<area>.client.ts`, its path derived from the `output.clients`
template via `computeSdkAreaClientOutPath` (`{filename}` and `{area}` resolve to the area
name, `{subarea}` resolves to empty). The aggregator `sdk.ts` only imports each
`<Area>Client` and wires it onto the `Sdk` class — it declares no client classes itself.

Multiple area-level files merge into one `<Area>Client`. Duplicate method names within that
merge **throw at codegen** — disambiguate with `sdk:` or split into a subarea.

## Shared runtime

The SDK emits `sdk-options.ts` alongside the client files, containing `SdkOptions`,
`createSdkFetch`, `buildQueryString`, `parseJson<T>`, and bigint JSON helpers. Void
operations (no response body) skip body consumption entirely.

## `sdk.scaffold`

`sdk.scaffold: true` emits a starter `package.json` and `tsconfig.json` at the SDK
`baseDir`, turning generated output into a standalone buildable package.
`generateSdkPackageJson` / `generateSdkTsconfig` live in `codegen-sdk.ts`. Deps are derived
from the surfaced contracts: `zod` when `zod: true`; `luxon` + `@types/luxon` when any
covered model uses a `date`/`time`/`datetime`/`interval` scalar (detected via
`rootNeedsScalar`). Pinned ranges live in `SCAFFOLD_DEP_VERSIONS`.

Both are emitted with `{ ifAbsent: true }` — created once, never overwritten, never
orphan-deleted, so turning `scaffold` off leaves the user's files untouched. See the
`ifAbsent` section of the parent skill.
