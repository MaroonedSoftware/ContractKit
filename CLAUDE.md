# ContractKit

A DSL for API contracts. `.ck` files compile to Zod schemas, Koa routers, TypeScript SDK
clients, Python SDK clients, OpenAPI 3.0 YAML, Bruno collections, and Markdown docs.

The pipeline is: Ohm grammar (`contractkit.ohm`) → `semantics.ts` → typed AST (`ast.ts`) →
CLI normalization passes → `decomposeCk` → each plugin's `generateTargets`. Everything in
`packages/plugin-*` is a consumer of that AST; `packages/openapi-to-ck` runs the reverse
direction. All packages publish under the `@contractkit` scope.

## Skills

Load these rather than rediscovering the semantics from source:

- **`ck-language`** — contract/field modifiers, multi-base inheritance, Zod schema shapes,
  discriminated unions, the `mcp` field, the response block (emitted vs documented statuses,
  several content types per status, response headers), header globals, `{{variable}}`
  substitution.
- **`ck-plugins`** — plugin config and hooks, per-operation plugin extensions, `emitFile`
  and write-once `ifAbsent` files, TS SDK client grouping and scaffold.
- **`ck-grammar-change`** — the lockstep checklist for any change to `.ck` syntax. Read it
  before touching `contractkit.ohm`.

## Gotchas

- **Normalization passes live in the CLI, not the parser.** `applyOptionsDefaults` and
  `applyVariableSubstitution` run between `parseCk` and `decomposeCk`. The prettier plugin
  calls `parseCk` directly and needs the raw AST to round-trip a file, so moving a pass
  inside the parser silently breaks the formatter.
- **A grammar change touches every plugin.** The TypeScript plugin is not the only consumer
  of the AST — Python, OpenAPI, Markdown, Bruno, and `openapi-to-ck` each need codegen and
  tests updated. See the `ck-grammar-change` skill.
- **`op.pluginExtensions`, never `op.plugins`,** at codegen time. `op.plugins` is the raw
  parse tree kept for prettier; `pluginExtensions` is the resolved one.
- **`ifAbsent` emits are user-owned.** Use for starter files only, never generated code.
- **Prettier round-trip is a hard requirement.** Union-typed AST nodes (e.g.
  `mcp?: boolean | McpConfigNode`) exist specifically to preserve the source form; don't
  normalize them away.
- Tests live in a top-level `tests/` folder per package, mirroring `src/`.
- After editing `ck.tmLanguage.json`, run `pnpm run vscode:install` to reload the extension.

## Testing

```bash
pnpm test
```

Scope with `pnpm --filter @contractkit/core test`, or a single file with
`pnpm --filter @contractkit/core exec vitest run tests/parser-ck.test.ts`.
