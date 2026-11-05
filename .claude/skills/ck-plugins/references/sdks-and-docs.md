# The other SDK plugins and the docs targets

Option tables are in `docs/config.md`. This covers what isn't obvious from them.

## Python, Kotlin, Swift, C#

| Plugin | Output | Method names |
| ------ | ------ | ------------ |
| `plugin-python` | Pydantic v2 models, httpx clients | `snake_case` |
| `plugin-kotlin` | kotlinx.serialization models, Ktor clients, `commonMain` | `camelCase`, backtick-escaped on a hard keyword |
| `plugin-swift` | `Codable` models, `async throws` clients, Foundation only | `camelCase`, backtick-escaped on a reserved word |
| `plugin-csharp` | `System.Text.Json` records, `HttpClient` clients, no NuGet dependencies | `PascalCase` + `Async`, `@`-escaped parameters |

Layout: `plugin-python` is `index.ts`, `codegen-models.ts` and `codegen-client.ts`. The other three add
`codegen-sdk.ts`, `naming.ts`, `scaffold.ts`, `runtime*.ts` (the source they emit for their runtime) and
`hoist.ts`.

`hoist.ts` exists because the `.ck` language lets a union, enum or object literal appear anonymously
in a field, and these languages need a name for every type. It runs once over all contract roots, not
per file, because a discriminated union in one file changes member classes in another.

Things all four share, so a change to one usually applies to the rest:

- Each client decides which statuses are values through `observableResponses`, and passes them to its runtime as `expectStatuses`.
- A `decimal` is checked against core's `DECIMAL_PATTERN` in the emitted runtime, since each language's
  own decimal parser accepts more than the wire form.
- An unknown enum value reads as a sentinel. See "Enums and unknown values" in the `ck-language` skill.
- A `text/event-stream` operation warns through `ctx.warn` and reads as one string, reported every run
  rather than from a cached render, so a cache hit does not hide it.
- In Kotlin, Swift and C#, `scaffold: true` emits build files as `ifAbsent`, so they are user-owned.
  Python has no scaffold option.

C# has two extra options: `targetFrameworks` (`netstandard2.0`, `net10.0`, with `Runtime/Polyfills.cs`
for the former) and `dateTypes` (`dateonly` or `datetime`).

## `plugin-docs`

A target is on when its key is present (`openapi`, `markdown`, `mintlify`, `docusaurus`). A config
naming none throws rather than silently emitting nothing.

- `src/naming.ts` is shared by all of them: titles, slugs, area grouping. `areaLabels`, at the plugin
  level or on `markdown`/`mintlify`/`docusaurus`, names an area's group, the target's map merged over
  the plugin's. An area with no entry is humanized, which cannot know `openai` should read "OpenAI".
- **markdown** and **docusaurus** share the renderer in `targets/markdown/codegen.ts`, varied only
  through `MarkdownDialect`.
- **mintlify** pages are frontmatter only, since Mintlify renders them from an OpenAPI spec. When the
  `openapi` target's output lands inside the Mintlify `baseDir`, one spec is emitted and shared
  (`resolveSharedSpec`).

### OpenAPI target

- `operationId` is unique across the document. `operationIds: 'service'` (default) takes `sdk:`, then the
  service method, then the SDK method name; `'sdk'` always takes the TypeScript SDK's name. A taken id
  falls back to the SDK method name, then gets a number (`uniqueOperationId`).
- A model used as a whole `query` or `headers` source becomes one parameter per field, bases included,
  named as the router reads it, rather than one object-typed parameter.
- For specs agents build connectors from: `operationSecurity: { read, write }` picks security per
  operation by `resolveMcpHints(op).readOnlyHint`, `tags` tags operations by area, `omitMcpExcluded`
  drops `mcp: exclude` operations, and `mcpAnnotations` adds `x-mcp-annotations`.
- An `output` ending in `.json` writes JSON rather than YAML.
- `decimal` publishes `decimalPattern(scale)` as its `pattern`. `text/event-stream` gets
  `x-contractkit-stream: true` on the media type.
