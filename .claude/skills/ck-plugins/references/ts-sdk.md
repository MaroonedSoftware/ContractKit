# TypeScript SDK codegen

Entry points are `generateAreaClient` and `generateSdkAggregator` in
`packages/plugin-typescript/src/codegen-sdk.ts`. Method names come from `deriveSdkMethodName` in core.

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
`createSdkFetch`, `buildQueryString`, `buildHeaders`, `parseJson<T>`, `readContentType`, bigint JSON
helpers and `parseBigIntHeader`, and the Server-Sent Events runtime (`parseSse`, `SseEventStream`,
`SseRequestOptions`, `sseRequestHeaders`). Void operations (no response body) skip body consumption
entirely.

A streaming operation returns `Promise<SseEventStream<Event>>` and takes a trailing optional
`requestOptions: { signal?, lastEventId? }`. It goes through the same `SdkFetch`, so custom fetch, auth
headers and a non-2xx `SdkError` behave as usual. See "Server-Sent Events" in the `ck-language` skill.

## Values on the wire

Clients don't parse a response against a schema: they run `parseJson` and a generated reviver.

- `reviveX` (`codegen-revive.ts`) turns wire text into the types the method declares: Luxon temporals
  and `Decimal` (`DEFAULT_REVIVABLE_SCALARS`). `interval` is deliberately not revived and stays a
  string. A `bigint` comes through the bigint JSON helpers.
- `serializeX` (`codegen-serialize.ts`) writes a request body in the text the router parses. Query,
  header and path params go through the same formats.
- `ModelWireInput` (`codegen-wire-input.ts`) types a request in its `format(input=)` casing.

See "Zod schema generation" in the `ck-language` skill's `references/models.md`.

`createSdkFetch` throws `SdkError` for a response at or above 400 **unless** its status is in
the `expectStatuses` the method passed — the operation's observable set, which covers a `304`
produced by middleware and any error status the service returns deliberately. `SdkError<TBody>`
carries the parsed body, and each operation whose thrown statuses declare a body also exports a
`…ErrorBody` alias to narrow it to. A method's return type comes from `observableResponses`, so
an operation a client can see more than one status from returns a union discriminated on
`status`. See the `ck-language` skill for which statuses land in which set.

## `sdk.scaffold`

`sdk.scaffold: true` emits a starter `package.json` and `tsconfig.json` at the SDK
`baseDir`, turning generated output into a standalone buildable package.
`generateSdkPackageJson` / `generateSdkTsconfig` live in `codegen-sdk.ts`. Deps are derived
from the surfaced contracts: `zod` when `zod: true`; `luxon` + `@types/luxon` when any
covered model uses a `date`/`time`/`datetime`/`duration`/`interval` scalar (detected via
`rootNeedsScalar`) or an emitted operation uses a `date`/`time`/`datetime`/`duration` in an inline
param, body or header (`opRootNeedsScalar`); `decimal.js` when either uses a `decimal`. Pinned ranges
live in `SCAFFOLD_DEP_VERSIONS`.

Both are emitted with `{ ifAbsent: true }` — created once, never overwritten, never
orphan-deleted, so turning `scaffold` off leaves the user's files untouched. See the
`ifAbsent` section of the parent skill.
