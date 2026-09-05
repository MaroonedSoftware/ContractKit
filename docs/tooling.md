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

| File metadata                          | Generated layout                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `area: identity, subarea: invitations` | `IdentityInvitationsClient` emitted as a leaf file; exposed as `sdk.identity.invitations.<method>`             |
| `area: identity` (no subarea)          | methods inlined directly on `IdentityClient` (no standalone `*.client.ts`); exposed as `sdk.identity.<method>` |
| neither                                | flat top-level property — `sdk.<filename>.<method>` (legacy behavior)                                          |

Multiple files mapping to the same `(area, subarea)` are merged into one client. Multiple area-level files contributing methods that collide on name fail at codegen time with a clear error — disambiguate with `sdk:` or move one into a subarea.

`{subarea}` is available as a path-template variable on `output.clients` and `output.types` alongside `{area}`, `{filename}`, and `{dir}`. Example: `output.clients: "src/{area}/{subarea}.client.ts"` produces `src/identity/invitations.client.ts`.

Python and Kotlin SDKs with the same operation coverage are available via
`@contractkit/plugin-python` and `@contractkit/plugin-kotlin`. Neither groups clients by area yet;
both emit one client per `.ck` file.

---

## Documentation Generation

OpenAPI 3.1 YAML and a Markdown reference are produced by the `openapi` and `markdown` targets of `@contractkit/plugin-docs`. The `mintlify` and `docusaurus` targets of the same plugin emit a whole docs site instead of one file. In all four, operations marked `internal` and any types unreachable from public operations are excluded.

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

The `contractkit-vscode-extension` extension provides:

- Syntax highlighting for `.ck` files
- Autocompletion for types, keywords, modifiers, and model references
- Hover information for built-in types and referenced models
- Cross-file model indexing
- Real-time diagnostics from the language server

Requires VS Code or Cursor 1.105.1+.

### Setup

```bash
cd apps/vscode-extension
pnpm install
pnpm run vscode:install
```

---
