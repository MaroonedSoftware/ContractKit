# ContractKit

Define an API once, in a file you can read aloud, and generate the parts you would otherwise
hand-write and keep in sync: Zod schemas, a Koa router, TypeScript and Python SDK clients, an
OpenAPI spec, Markdown docs, and a Bruno collection.

```
contract Pet: {
    id: readonly uuid
    name: string
    status: enum(available, pending, sold) = available
}

operation /pets/{id}: {
    params: {
        id: uuid
    }
    get: { # fetch a pet
        sdk: getPet
        service: PetService.getById
        response: {
            200: { application/json: Pet }
            404:
        }
    }
}
```

That file is the source of truth. Everything else is generated from it, and regenerated when it
changes.

## Install

```bash
pnpm add -D @contractkit/cli @contractkit/plugin-typescript
```

Create `contractkit.config.json` next to your contracts. `patterns` tells the CLI which files to
compile, and `plugins` maps each plugin's package name to its options:

```json
{
    "rootDir": ".",
    "patterns": ["contracts/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-typescript": {
            "types": { "baseDir": "src/generated/", "output": "{filename}.types.ts" }
        }
    }
}
```

That emits plain TypeScript types. Swap `types` for `zod`, `server`, `sdk`, or `mcp` — or combine
them — as you need more; see [Configuration](docs/config.md) for every sub-config.

Then compile:

```bash
contractkit                       # compile once
contractkit -w                    # --watch: recompile on change
contractkit --force               # skip the incremental cache, recompile everything
contractkit -c path/to/config.json  # --config: use a specific config file
```

Without `--config`, the CLI searches upward from the working directory for
`contractkit.config.json`. It handles discovery, caching and formatting only — every generated
artefact comes from a plugin.

## Documentation

| Guide                                  | Covers                                                                                                           |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Language reference](docs/language.md) | Every `.ck` construct: contracts, fields, types, operations, responses, security, MCP, plugin extensions         |
| [Configuration](docs/config.md)        | `contractkit.config.json`, the built-in plugins and their options, writing your own plugin                       |
| [Tooling](docs/tooling.md)             | SDK generation, docs generation, incremental compilation, cross-file validation, Prettier, the VS Code extension |

Per-package READMEs live under [`packages/`](packages) and [`apps/`](apps). Working contracts to
copy from are in [`contracts/`](contracts).

For AI assistants: [`llms.txt`](llms.txt) is a machine-readable index of all of it, and
[`llms-full.txt`](llms-full.txt) is the same ground covered in one self-contained document. Every
published package also ships its own `llms.txt` beside its README.

## Cheat sheet

Every construct in the language, in one block. The [language reference](docs/language.md)
explains each one.

```
# ─── File metadata (optional, one per file) ──────────────────────────────
options {
    keys: {
        area: billing                    # interpolated elsewhere as {{area}}
    }
    services: {
        PetService: "#modules/pet/pet.service.js"
    }
    request:  { headers: { x-request-id: string } }   # merged into every operation
    response: { headers: { x-trace-id: string } }
    security: { policy: authenticated }
}

# ─── Contracts ───────────────────────────────────────────────────────────
contract Pet: {                          # a model
    id: readonly uuid                    # readonly — dropped from Input variants
    secret: writeonly string             # writeonly — dropped from Output variants
    name: string(min=1, max=80)          # constraints
    tags?: array(string, min=1)          # optional
    owner: Person | null                 # nullable via union
    status: enum(available, sold) = available   # default
    legacy: deprecated string
    meta: record(string, json)
    pair: tuple(int, string)
    self: lazy(Pet)                      # self-reference
}

contract Admin: Person & Auditable & {   # multi-base inheritance
    role: string
}
contract Id: uuid                        # type alias
contract Shape: discriminated(by=kind, Circle, Square)

contract mode(loose) Loose: { a: string }             # unknown keys pass through
contract format(input=snake) Snake: { userId: int }   # wire casing

# ─── Operations ──────────────────────────────────────────────────────────
operation(internal) /pets/{id}: {        # internal | deprecated | public
    params: {
        id: uuid
    }
    security: { policy: petsWrite }      # or `security: none`

    get: { # doc comment
        name: Get a pet                  # human label for docs
        sdk: getPet                      # SDK method name
        service: PetService.getById      # handler binding
        mcp: { hint: readOnly }          # expose as an MCP tool
        signature: webhookKey            # HMAC-verified body

        query: {
            page?: int = 1
        }
        headers: {
            x-api-key: string
        }
        request: {
            application/json: PetInput
        }
        response: {
            200: {                       # has a block, or is 2xx => the service returns it
                image/png: binary        # several mimes: the service picks one
                image/jpeg: binary
                headers: {
                    etag?: string
                }
            }
            202: { application/json: JobRef }
            304: {}                      # empty block: returned, carries nothing
            404:                         # bare non-2xx: documented, reaches clients as an error
            409(documented): { application/json: Problem }   # declared, but not returned
        }
        plugins: {
            bruno: { template: "file://pets.yml" }   # plugin values are JSON-typed
        }
    }
}
```

## Packages

All packages publish under the `@contractkit` npm scope.

| Package                                                        | Purpose                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`@contractkit/cli`](apps/cli)                                 | The `contractkit` binary — discovery, config, plugin orchestration                                                                   |
| [`@contractkit/core`](packages/contractkit)                    | Grammar, parser, AST, semantics, validation, plugin interface                                                                        |
| [`@contractkit/plugin-typescript`](packages/plugin-typescript) | Koa routers, TypeScript SDK, Zod schemas, plain types, MCP tools                                                                     |
| [`@contractkit/plugin-python`](packages/plugin-python)         | Python SDK (Pydantic v2 + httpx)                                                                                                     |
| [`@contractkit/plugin-docs`](packages/plugin-docs)             | Documentation outputs: OpenAPI 3.1 YAML, a Markdown reference, a Mintlify site, and a Docusaurus docs folder                         |
| [`@contractkit/plugin-bruno`](packages/plugin-bruno)           | Bruno REST collection                                                                                                                |
| [`@contractkit/openapi-to-ck`](packages/openapi-to-ck)         | OpenAPI YAML → `.ck`, for adopting an existing API                                                                                   |
| [`@contractkit/explorer-ui`](packages/explorer-ui)             | HTML renderer behind the VS Code API explorer                                                                                        |
| [`@contractkit/prettier-plugin`](apps/prettier-plugin)         | Prettier plugin for `.ck` files                                                                                                      |
| `contractkit-vscode-extension`                                 | VS Code / Cursor language support — LSP plus syntax highlighting. Built from source, not published ([source](apps/vscode-extension)) |

## Contributing

```bash
pnpm install
pnpm test
pnpm build
```

Scope to one package with `pnpm --filter @contractkit/core test`, or to a single file with
`pnpm --filter @contractkit/core exec vitest run tests/parser-ck.test.ts`.

Shared tooling config lives in the private `@repo/config-typescript` and `@repo/config-eslint`
packages, which every workspace extends.

The compiler core is small enough to read in an afternoon:

```
packages/contractkit/src/
  contractkit.ohm             # Ohm PEG grammar — the source of truth for the language
  semantics.ts                # Parse tree → AST
  parser.ts                   # parseCk() entry point
  ast.ts                      # AST type definitions
  type-utils.ts               # Type ref collection, topo sort, input-model graph
  response-sets.ts            # Which responses are emitted / observable / thrown
  apply-options-defaults.ts   # Merges options-level header globals into operations
  apply-variable-substitution.ts  # Expands {{name}} references
  validate-refs.ts            # Cross-file type reference validation
  validate-inheritance.ts     # Multi-base inheritance validation
  validate-operation.ts       # Path parameter and operation validation
  plugin.ts                   # ContractKitPlugin / PluginContext interfaces
```

Both normalization passes run in the CLI between `parseCk` and `decomposeCk`, not inside the
parser — the Prettier plugin calls `parseCk` directly and needs the unmerged AST to round-trip a
file. Changing the grammar is never a one-file change; the checklist of what must move with it is
in `.claude/skills/ck-grammar-change/`.
