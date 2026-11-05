# ContractKit

A DSL for API contracts. `.ck` files compile to Zod schemas, Koa or Fastify routers, MCP tool
handlers, TypeScript, Python, Kotlin, Swift and C# SDK clients, OpenAPI 3.1, Markdown, Mintlify and
Docusaurus docs, and Bruno collections.

The pipeline is: Ohm grammar (`contractkit.ohm`) → `semantics.ts` → typed AST (`ast.ts`) →
CLI normalization passes → `decomposeCk` → cross-file validation → each plugin's `generateTargets`.
Everything in `packages/plugin-*` is a consumer of that AST; `packages/openapi-to-ck` runs the
reverse direction. All published packages use the `@contractkit` scope.

## Layout

- `packages/contractkit` (`@contractkit/core`): grammar, parser, AST, validators, the one `.ck`
  printer (`src/print/`), and the rules every generator shares.
- `packages/plugin-{typescript,python,kotlin,swift,csharp,docs,bruno}`: the generators.
- `packages/openapi-to-ck`: OpenAPI to `.ck`, exposed as `contractkit import-openapi`.
- `packages/explorer-ui`: HTML renderer over AST nodes, used by the editor's API preview.
- `packages/output-tests` (`@repo/output-tests`, private): snapshots and compile checks of real
  generated output.
- `apps/cli` (`contractkit` binary), `apps/prettier-plugin`, `apps/vscode-extension` (LSP plus
  TextMate grammar).

User-facing reference lives in `docs/language.md` and `docs/config.md`. Link to them instead of
restating them.

## Skills

Load these rather than rediscovering the semantics from source:

- **`ck-language`**: contract/field modifiers, multi-base inheritance, Zod schema shapes,
  scalars and their wire forms, discriminated unions, unknown enum tolerance, route modifiers and
  the security cascade, webhook signatures, the `mcp` field, the response block (emitted vs
  documented statuses, several content types per status, Server-Sent Events, response headers),
  header globals, `{{variable}}` substitution.
- **`ck-plugins`**: plugin config and hooks, per-operation plugin extensions, `emitFile`
  and write-once `ifAbsent` files, the TypeScript server, MCP and SDK sub-generators, the other SDK
  plugins, the docs targets.
- **`ck-grammar-change`**: the lockstep checklist for any change to `.ck` syntax. Read it
  before touching `contractkit.ohm`.

## Gotchas

- **Normalization passes live in the CLI, not the parser.** `applyOptionsDefaults` and
  `applyVariableSubstitution` run between `parseCk` and `decomposeCk`. The prettier plugin
  calls `parseCk` directly and needs the raw AST to round-trip a file, so moving a pass
  inside the parser silently breaks the formatter.
- **A grammar change touches every plugin.** The TypeScript plugin is not the only consumer
  of the AST: Python, Kotlin, Swift, C#, Bruno, `openapi-to-ck`, `explorer-ui` and all four
  `plugin-docs` targets (openapi, markdown, mintlify, docusaurus) each need checking. Docusaurus
  shares the markdown target's renderer through the `MarkdownDialect` seam; mintlify does not, and
  renders from the OpenAPI spec instead. See the `ck-grammar-change` skill.
- **Shared rules live in core, so generators cannot disagree.** Call them rather than re-deriving:
  `emittedResponses`/`observableResponses`/`thrownResponses`/`eventStreamResponse`
  (`response-sets.ts`), `classifyContentType` (`content-type.ts`), `isMcpTool` (`ast.ts`),
  `resolveMcpHints` (`mcp-hints.ts`), `deriveSdkMethodName` (`sdk-method-name.ts`),
  `DECIMAL_PATTERN`/`decimalPattern` (`decimal-pattern.ts`), `resolveEffectiveFields`
  (`type-utils.ts`), `resolveModifiers`/`resolveSecurity` (`ast.ts`).
- **Two lists wire up validation.** `apps/cli/src/cli.ts` calls the cross-file validators itself,
  and `validateProject` (`validate-project.ts`, used by the editor) has its own list. A new pass
  has to go in both. They differ today: `validateDecimal` runs only in `validateProject`, so a CLI
  build does not run it.
- **`op.pluginExtensions`, never `op.plugins`,** at codegen time. `op.plugins` is the raw
  parse tree kept for prettier; `pluginExtensions` is the resolved one.
- **`ifAbsent` emits are user-owned.** Use for starter files only, never generated code.
- **Bump the plugin's `*_CODEGEN_VERSION`** (`TYPESCRIPT_CODEGEN_VERSION` and so on) when its output
  shape changes: it busts every per-file fingerprint in the plugin's incremental manifest. A
  generator that starts reading data from another file must also add that data to the unit's
  fingerprint, or a cache hit serves stale output.
- **Prettier round-trip is a hard requirement.** Union-typed AST nodes (e.g.
  `mcp?: boolean | 'exclude' | McpConfigNode`) exist specifically to preserve the source form; don't
  normalize them away.
- **Generated code imports runtime packages that are not installed here.** The server output uses
  `@maroonedsoftware/*`. `packages/output-tests/tests/ambient.d.ts` stubs them for the compile
  checks, so a generator that starts calling a new runtime symbol needs a stub there too.
- Tests live in a top-level `tests/` folder per package, mirroring `src/`.
- After editing `ck.tmLanguage.json`, run `pnpm run vscode:install` to rebuild the extension and
  install it (the script calls `cursor --install-extension`, so it needs the Cursor CLI).

## Testing

```bash
pnpm test
```

Scope with `pnpm --filter @contractkit/core test`, or a single file with
`pnpm --filter @contractkit/core exec vitest run tests/parser-ck.test.ts`.

Workspace packages resolve each other through `dist/`, with no source alias in the vitest configs.
`pnpm test` runs through turbo, which builds first. A filtered run does not, so after changing core,
run `pnpm build` before a plugin's tests can see it.

`packages/output-tests` builds the fixtures in `tests/fixtures/` through every plugin and compares
each emitted file with a snapshot in `tests/__snapshots__/`, plus a `_files.txt` listing per plugin
and `_diagnostics.txt`. After an intended output change, run
`pnpm --filter @repo/output-tests exec vitest run -u` and read the diff, which is the review of the
change. A new construct needs a fixture, or nothing checks it end to end.

The compile checks there skip themselves when the toolchain is missing:

- Generated TypeScript is always type-checked (`typecheck.test.ts`).
- C# builds when `dotnet` is on PATH. CI installs it.
- Swift builds when `swift` is on PATH. The CI workflow has no step installing it.
- Python syntax checks need `python3`. `mypy --strict` and importing the SDK also need `CK_TEST_PYTHON`
  pointing at a Python 3.11+ with mypy, pydantic and httpx installed. CI has none of those three, so
  those checks are skipped there.
- Generated Kotlin is not compiled by any test.

`packages/contractkit/tests/readme-examples.test.ts` parses every whole-file `.ck` example in
`README.md` and `docs/*.md`, so a broken example in those files fails the core suite.

## Releases

A change to a published package needs a changeset: add a `.changeset/<name>.md`, or run
`pnpm changeset`. The `chore: update versions` commits come from the release flow and consume them.
