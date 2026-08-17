# Tooling

## SDK Generation

The TypeScript SDK is produced by the `sdk` sub-config of `@contractkit/plugin-typescript`. The aggregator class, barrel exports, and a shared `sdk-options.ts` runtime helper are emitted automatically.

```typescript
import { MyappSdk } from '@myapp/sdk';

const sdk = new MyappSdk({ baseUrl: 'https://api.example.com' });
const users = await sdk.users.list({ query: { page: 1 } });
```

### Subclient grouping

`keys.area` and `keys.subarea` (set in a file's `options { keys: { ... } }` block) drive how operations cluster on the generated SDK:

| File metadata | Generated layout |
| --- | --- |
| `area: identity, subarea: invitations` | `IdentityInvitationsClient` emitted as a leaf file; exposed as `sdk.identity.invitations.<method>` |
| `area: identity` (no subarea) | methods inlined directly on `IdentityClient` (no standalone `*.client.ts`); exposed as `sdk.identity.<method>` |
| neither | flat top-level property — `sdk.<filename>.<method>` (legacy behavior) |

Multiple files mapping to the same `(area, subarea)` are merged into one client. Multiple area-level files contributing methods that collide on name fail at codegen time with a clear error — disambiguate with `sdk:` or move one into a subarea.

`{subarea}` is available as a path-template variable on `output.clients` and `output.types` alongside `{area}`, `{filename}`, and `{dir}`. Example: `output.clients: "src/{area}/{subarea}.client.ts"` produces `src/identity/invitations.client.ts`.

A Python SDK with the same operation coverage is available via `@contractkit/plugin-python`.

---

## Documentation Generation

OpenAPI 3.1 YAML and a Markdown reference are produced by the `@contractkit/plugin-openapi` and `@contractkit/plugin-markdown` plugins respectively. In both, operations marked `internal` and any types unreachable from public operations are excluded.

A Bruno REST collection can be generated via `@contractkit/plugin-bruno`.

---

## Incremental Compilation

The compiler caches file hashes and skips unchanged files on subsequent runs. Set `"cache": true` in your config to enable. The cache directory (`.contractkit/cache` by default) holds both build hashes (`build.json`) and any fetched plugin extension HTTP responses (`http/`); pass a string for `cache` to override the directory. Use `--force` to bypass the cache and recompile everything.

---

## Cross-File Validation

The compiler validates type references across files. If a field or operation references a model that doesn't exist in any parsed file, a warning is emitted.

---

## Prettier Integration

Set `"prettier": true` in your config to format all generated TypeScript files using your project's local prettier installation.

The `@contractkit/prettier-plugin` package formats `.ck` files themselves. Add it to your prettier config:

```json
{
    "plugins": ["@contractkit/prettier-plugin"]
}
```

---

## VS Code Extension

`@contractkit/vscode-extension` is a language server, not just a colour scheme. It indexes every
`.ck` file in the workspace, so hover, completion, go-to-definition, find-references and rename all
work across files.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/figures/vscode-explorer-dark.svg">
  <img alt="The ContractKit Explorer in the sidebar, listing every endpoint in the workspace grouped by area, beside the contract source." src="../assets/figures/vscode-explorer-light.svg" width="816">
</picture>

The **ContractKit Explorer** view lists every endpoint and model, grouped by file, area or method.
Clicking one opens a preview panel with its params, schemas and responses, plus a Try-it form that
sends the request from the extension host:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/figures/vscode-preview-dark.svg">
  <img alt="The API preview panel for POST /orders, showing its security policy, headers, request body and four declared responses beside the contract source." src="../assets/figures/vscode-preview-light.svg" width="833">
</picture>

Diagnostics from the same validation passes the CLI runs appear as you type, with quick fixes:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/figures/vscode-diagnostics-dark.svg">
  <img alt="A misspelled model reference underlined as you type, with a quick fix offering the closest matching name." src="../assets/figures/vscode-diagnostics-light.svg" width="519">
</picture>

The full feature list, settings, and commands are in the
[extension README](../apps/vscode-extension/README.md). Requires VS Code or Cursor 1.105.1+.

### Setup

```bash
# From the repo root
pnpm run vscode:install
```

---

## Documentation Figures

The code figures in this repository's Markdown are rendered, not screenshotted. `pnpm docs:images`
runs [`packages/docs-images`](../packages/docs-images), which colours excerpts of the checked-in
contracts under [`contracts/`](../contracts) with the VS Code extension's own TextMate grammar and
writes a dark and a light SVG per figure into `assets/figures/`.

Two consequences worth knowing:

- Changing `contractkit.ohm` and `ck.tmLanguage.json` changes the documentation's highlighting on
  the next run. There is no second copy of the colouring rules to update.
- Figures are anchored to text in the contracts, not line numbers. Editing a contract moves its
  figure; deleting the anchored declaration fails the render instead of showing the wrong lines.

---
