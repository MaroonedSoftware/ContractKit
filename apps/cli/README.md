# @contractkit/cli

The `contractkit` binary — orchestrates parsing, plugin loading, incremental caching, and prettier formatting for `.ck` contract files.

## Installation

```bash
pnpm add -D @contractkit/cli
```

This package only handles file discovery, configuration, caching, and dispatch to plugins. **All code generation lives in plugins** that you list under `"plugins"` in `contractkit.config.json`.

## Usage

```bash
contractkit [options]

Options:
  -c, --config <path>  Path to config file (default: searches for contractkit.config.json)
  -w, --watch          Watch for changes and recompile
      --force          Skip incremental cache, recompile all
  -h, --help           Show help
```

The CLI walks upward from the current directory looking for `contractkit.config.json` if `-c` is not provided.

## Configuration

Create `contractkit.config.json` at your project root:

```json
{
    "rootDir": ".",
    "cache": true,
    "prettier": true,
    "patterns": ["contracts/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-typescript": {
            "server": {
                "baseDir": "apps/api/",
                "zod": true,
                "output": {
                    "routes": "src/routes/{filename}.router.ts",
                    "types": "src/modules/{area}/types/{filename}.ts"
                },
                "servicePathTemplate": "#modules/{module}/{module}.service.js"
            }
        },
        "@contractkit/plugin-openapi": {
            "baseDir": "docs/api/",
            "output": "openapi.yaml",
            "info": { "title": "My API", "version": "1.0.0" }
        }
    }
}
```

### Top-level fields

| Field | Type | Description |
| --- | --- | --- |
| `rootDir` | `string` | Base directory for resolving relative paths. Supports `~` for `$HOME`. Default: `.` |
| `cache` | `boolean \| string` | Enable incremental compilation cache. Pass a string to use a custom cache filename. Default: `false`. |
| `prettier` | `boolean` | Format generated TypeScript files with the project's local prettier. Default: `false`. |
| `patterns` | `string[]` | Glob patterns for `.ck` files to compile, relative to `rootDir`. |
| `plugins` | `object` | Map of plugin package name → options. The CLI loads each key as a plugin and passes its value to the plugin as `ctx.options`. Any `keys: { ... }` entries inside a plugin's options are also merged into a workspace-wide fallback map for `{{var}}` substitution in `.ck` files (file-local `options.keys` still wins). The values themselves can reference the built-ins `{{rootDir}}` and `{{configDir}}` for the resolved config paths. |

## Incremental cache

When `"cache": true`, the CLI hashes each `.ck` file plus the resolved plugin config and skips files whose inputs haven't changed since the last run. Caches live under `.contractkit/cache/` (override the directory by passing a string for `cache`): `build.json` for build hashes, and `http/<sha256(url)>` for any fetched plugin extension HTTP responses. Use `--force` to bypass everything.

## Built-in plugins

Each plugin is its own npm package, listed under `"plugins"`:

| Package | Generates |
| --- | --- |
| [`@contractkit/plugin-typescript`](../../packages/plugin-typescript) | Koa routers, TypeScript SDK clients, Zod schemas, plain TS types |
| [`@contractkit/plugin-openapi`](../../packages/plugin-openapi) | OpenAPI 3.0 YAML |
| [`@contractkit/plugin-markdown`](../../packages/plugin-markdown) | Markdown API reference |
| [`@contractkit/plugin-bruno`](../../packages/plugin-bruno) | Bruno REST collection |
| [`@contractkit/plugin-python`](../../packages/plugin-python) | Python SDK client (Pydantic v2 + httpx) |

For writing your own plugin, see [@contractkit/core](../../packages/contractkit#plugin-api).

## Subcommands

Plugins can register additional CLI subcommands via the `command` hook. For example, `@contractkit/openapi-to-ck` registers `contractkit openapi-to-ck` for converting an OpenAPI YAML file back into `.ck` files.

```bash
contractkit openapi-to-ck --input openapi.yaml --output contracts/
```

Run `contractkit --help` to list registered subcommands.
