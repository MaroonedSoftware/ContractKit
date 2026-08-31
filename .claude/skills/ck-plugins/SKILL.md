---
name: ck-plugins
description: How ContractKit's codegen plugins are configured, loaded, and dispatched — contractkit.config.json shape, the ContractKitPlugin hooks, per-operation plugin extensions (file:// and http:// resolution), and emitFile semantics including write-once ifAbsent files. Use when writing or changing a plugin, the CLI plugin pipeline, or plugin config.
---

# Plugin system

Plugins are configured in `contractkit.config.json` under `"plugins"`. Each key is the npm
package name; its value is passed as `ctx.options` to that plugin. The interface lives in
`packages/contractkit/src/plugin.ts`.

## Hooks

- `transform` — mutate the AST per file, before validation
- `validate` — throw to fail compilation
- `validateExtension(value)` — validate this plugin's per-operation
  `pluginExtensions[name]` entry; return `{ errors?, warnings? }` (errors fail compilation)
- `generateTargets` — called once after all files are parsed; call `ctx.emitFile()` per output
- `command` — register a CLI subcommand (`contractkit <name>`)

## `ctx.emitFile` and `ifAbsent`

`ctx.emitFile(path, content, { ifAbsent: true })` (`EmitFileOptions` in `plugin.ts`) marks
a **write-once, user-owned** file. The semantics are enforced end to end:
`IncrementalOutputFile.ifAbsent` keeps the path out of the manifest's tracked-paths set so
it never appears in `deletedPaths`, and the CLI write loop (`cli.ts`) skips the write when
the target exists and excludes it from the `__files__` orphan list. Net effect: created
once, never overwritten, never orphan-deleted.

Use `ifAbsent` for starter files the user is expected to edit. **Never** for generated code.

## Per-operation plugin extensions

The `plugins:` block on an operation accepts JSON-like values (string, number, boolean,
null, object, array). Each entry's key maps to a plugin by `name`.

1. The parser builds `op.plugins: Record<string, PluginValue>` — raw AST, retained so
   prettier can round-trip it.
2. The CLI runs `resolvePluginExtensions` (`apps/cli/src/resolve-plugin-extensions.ts`,
   async): it walks each value tree and replaces strings starting with `file://` (resolved
   relative to the `.ck` file) or `http(s)://` (fetched via GET) with the payload. The
   transformed tree is stored at `op.pluginExtensions`. Missing files, network errors, and
   non-2xx responses warn and leave the URL string in place. Each unique HTTP URL is
   fetched at most once per run; with caching enabled, successful responses persist via
   `CacheService.httpCache()` and are reused across runs. `--force` (or `cache: false`)
   skips both caches.
3. The CLI dispatches each `pluginExtensions[name]` entry to the plugin whose `name`
   matches; `validateExtension` returns errors/warnings the CLI emits on `op.loc.line`.
4. **Plugins read `op.pluginExtensions[name]`, never `op.plugins`.** Bruno expects
   `{ template?: string }` where `template` is a YAML fragment deep-merged into the
   generated request; `validateBrunoExtension` enforces the shape.

## The TypeScript plugin's config

`@contractkit/plugin-typescript` handles all TS output through optional sub-configs
(`server`, `sdk`, `mcp`):

```json
"@contractkit/plugin-typescript": {
    "server": {
        "baseDir": "apps/api/",
        "zod": true,
        "output": {
            "routes": "src/routes/{filename}.router.ts",
            "types": "src/modules/{area}/types/{filename}.ts"
        },
        "servicePathTemplate": "#modules/{module}/{module}.service.js"
    },
    "sdk": {
        "baseDir": "packages/sdk/",
        "name": "homegrown",
        "zod": true,
        "output": {
            "sdk": "src/{name}.sdk.ts",
            "types": "src/{area}/types/{filename}.ts",
            "clients": "src/{area}/{filename}.client.ts"
        }
    }
}
```

`zod: true` makes `output.types` emit Zod schemas (via `generateContract`) instead of plain
TypeScript interfaces. Path templates support `{filename}`, `{dir}`, `{area}`, `{subarea}`,
and `{name}`.

`server.validateResponses: true` (requires `zod: true`, enforced by `assertValidConfig` in
`index.ts`) makes each handler re-parse the service result through its response schema and write
the *parsed* value: `ctx.body = await parseAndValidate(result, User, 500)`. The `500` is what routes
the field-level detail to `internalDetails`, keeping it off the response body. Two kinds of body are
deliberately left unvalidated, both decided by `isRevalidatable` in `codegen-operation.ts`: anything
transitively referencing a `format(...)` model — its schema transforms keys, and the service already
returns the post-transform shape — and a status whose several mimes carry *different* body types.
Note the first check needs `computeModelsWithCaseTransform`, **not** `modelsWithOutput`: the latter
seeds only from `outputCase`, so a `format(input=snake)`-only model would slip through it.

SDK method names resolve in priority order: `sdk:` field → `name:` field (camelCased) →
inferred from HTTP method + path. The Python SDK uses the same priority but `snake_case`.

For SDK client grouping and the `scaffold` option, read `references/ts-sdk.md`.
