---
name: ck-plugins
description: How ContractKit's codegen plugins are configured, loaded, and dispatched. contractkit.config.json shape, the ContractKitPlugin hooks and pipeline order, per-operation plugin extensions (file:// and http:// resolution), emitFile semantics including write-once ifAbsent files, the TypeScript plugin's server, sdk, mcp sub-configs and framework seam (Koa, Fastify), path templates, servicePathTemplate, and pointers for the Python, Kotlin, Swift, C# and docs plugins (OpenAPI, Markdown, Mintlify, Docusaurus, areaLabels). Use when writing or changing a plugin, the CLI plugin pipeline, or plugin config.
---

# Plugin system

Plugins are configured in `contractkit.config.json` under `"plugins"`. Each key is the npm
package name; its value is passed as `ctx.options` to that plugin. The interface lives in
`packages/contractkit/src/plugin.ts`. User-facing option tables: `docs/config.md`.

## Hooks

- `cacheKey`: fingerprints the plugin's outputs in the CLI's build cache; change it when the
  output shape changes
- `validate`: per file; throw to fail compilation
- `transform`: per file, right after `validate`; mutate and return the AST
- `validateExtension(value)` — validate this plugin's per-operation
  `pluginExtensions[name]` entry; return `{ errors?, warnings? }` (errors fail compilation)
- `generateTargets` — called once after all files are parsed; call `ctx.emitFile()` per output
- `command` — register a CLI subcommand (`contractkit <name>`)

`PluginContext` also carries `options`, `rootDir`, `cacheEnabled`, `cacheDir`, and an optional
`warn(message, file?, line?)`. Prefer `ctx.warn?.(...)` for a problem that affects part of the output:
the CLI catches a `generateTargets` throw, records an error, and moves on, which costs that plugin all
its output.

The order in `apps/cli/src/cli.ts`, per file: `parseCk` → `applyOptionsDefaults` →
`applyVariableSubstitution` → each plugin's `validate` then `transform` → `decomposeCk`. Then, once:
`resolvePluginExtensions` → `validateExtension` → `validateRefs` → `validateInheritance` → `validateOp`
→ each plugin's `generateTargets`.

A plugin with its own per-unit incremental manifest (`runIncrementalCodegen` in `incremental.ts`) keys
it on a `*_CODEGEN_VERSION` constant and on each unit's fingerprint. Bump the constant when the output
shape changes, and hash anything a unit reads from another file into its fingerprint.

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
   non-2xx responses warn and leave the URL string in place. So do a `file://` path escaping
   `rootDir`, and an HTTP target that is loopback, private or link-local (checked after DNS
   resolution), that redirects, that exceeds 5 MB, or that takes over 10 seconds. Each unique HTTP URL is
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
(`server`, `sdk`, `zod`, `types`, `mcp`); each one present turns on its generator:

```json
"@contractkit/plugin-typescript": {
    "server": {
        "baseDir": "apps/api/",
        "framework": "koa",
        "zod": true,
        "output": {
            "routes": "src/routes/{filename}.router.ts",
            "types": "src/modules/{area}/types/{filename}.ts"
        },
        "servicePathTemplate": "#modules/{kebab}/{kebab}.service.js"
    },
    "sdk": {
        "baseDir": "packages/sdk/",
        "name": "myapp",
        "zod": true,
        "output": {
            "sdk": "src/{name}.sdk.ts",
            "types": "src/{area}/types/{filename}.ts",
            "clients": "src/{area}/{filename}.client.ts"
        }
    }
}
```

`server.framework` picks the HTTP framework the routers target: `koa` (the default) or `fastify`,
with adapters in `src/server-framework-koa.ts` and `src/server-framework-fastify.ts`;
`assertValidConfig` in `index.ts` rejects anything else by name. Every
framework-specific string — the router declaration, the import line, path-param syntax, guard
calls, the request accessors, the container lookup, the status/header/type/body writes, and the whole
`mcp.router.ts` template — comes from a `ServerFramework` (`src/server-framework.ts`, Koa's
implementation in `src/server-framework-koa.ts`). Codegen keeps ownership of control flow, so a new
framework is a new adapter rather than a change to `codegen-operation.ts`. The adapter also declares
`handlerLocals`, the identifiers its handler signature binds, so a path parameter that would shadow
one is renamed rather than emitted as a redeclaration. Streaming adds `response.openSse()`,
`request.lastEventId` and `streamSetup()` to the seam.

A route's guards and body declaration reach `routeOpen` as a `RouteMiddleware` (`policy`/`signature`
are pre-rendered guard-call expressions; `bodyContentTypes` is the operation's raw, deduped MIME
list) rather than a flat middleware array — Koa and Fastify disagree on what a route *does* with a
declared body (a `bodyParserMiddleware` call vs. a literal `config.body`), so only the adapter that
needs to render it sees it. A framework whose routes are written inside the router's own function
body rather than as top-level statements against it — Fastify's `FastifyPluginAsync`, unlike Koa's
bare `ServerKitRouter()` value — sets `routerWrapsRoutes: true` and returns the closing line(s) from
`routerClose()`; `generateOp` indents that framework's routes one level and appends the close.

`policy` and `signature` expressions are rendered by `src/route-guards.ts`, which the operation
routers and the MCP mount both call — the adapter decides how a guard is *written*, `route-guards.ts`
decides what its argument *says*, and neither router can spell the same declaration differently. The
`mcpRouter` seam takes `{ path, guards }` for the same reason: the mount's route line goes through
the adapter's own `routeOpen`, and the adapter derives its import lines by probing the body it
produced, the way `generateOp` does.

MCP output enforces contract security in two places. Every generated tool handler opens with
`requireMcpPolicy` for its operation's effective security (`MFA_SATISFIED_POLICY` when the operation
declares none, nothing when it declares `security: none`), because one `tools/call` reaches every
registered tool and the route guard cannot stand in for a per-tool gate. The route guard itself
defaults to `requirePolicy({ policy: false })`, or to nothing when any exposed tool is public
(`defaultMcpMountSecurity`), and `mcp.security` overrides it. Tool generation, `mcp.resolve` and `mcp.catalog` are in
"The `mcp` field" in the `ck-language` skill's `references/operations.md`.

`zod: true` makes `output.types` emit Zod schemas (via `generateContract`) instead of plain
TypeScript interfaces. Path templates support `{filename}`, `{dir}`, and any key from the source
file's `options { keys }` (hence `{area}`, `{subarea}`), plus `{name}` in `output.sdk`. A variable with
no value stays in the path literally and the plugin warns through `ctx.warn`.

`servicePathTemplate` is a different substitution: `deriveModulePath` in `codegen-operation.ts` replaces
only `{name}` (`LedgerService` → `Ledger`) and `{kebab}` (→ `ledger`). A file's `options { services }`
entry for that service wins over the template. `{module}` is not a variable here and stays literal.

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
inferred from HTTP method + path (`deriveSdkMethodName` in core, which `plugin-docs` also uses for its
"SDK method" note). The Python SDK uses the same priority but `snake_case`; the
Kotlin SDK keeps `camelCase` and backtick-escapes a name that lands on a Kotlin hard keyword; the
Swift SDK does the same against Swift's reserved words. The C# SDK spells it `PascalCase` with an
`Async` suffix and `@`-escapes a *parameter* that lands on a C# keyword (a PascalCase method name
never needs it).

## Reference files

| File | Covers |
| ---- | ------ |
| `references/ts-sdk.md` | TS SDK client grouping, the shared runtime, wire types, the `scaffold` option |
| `references/sdks-and-docs.md` | The Python, Kotlin, Swift and C# plugins, `plugin-docs` and its targets |
