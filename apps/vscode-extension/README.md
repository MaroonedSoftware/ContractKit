# ContractKit (VS Code extension)

Language support for ContractKit `.ck` contract files in VS Code and Cursor. Includes syntax highlighting, completion, hover, go-to-definition, document symbols, and live diagnostics from a Language Server.

## Features

- **Syntax highlighting** via TextMate grammar (`syntaxes/ck.tmLanguage.json`)
- **Auto-completion** for built-in types, modifiers, keywords, HTTP methods, content types, security blocks, and cross-file model references
- **Hover information** for built-in types and referenced models
- **Go-to-definition** — jumps from a model reference to its `contract` declaration, or from a `service:` reference (e.g. `PaymentsService.foo`) to its entry in the file's `options { services { ... } }` block. Resolves across any indexed `.ck` file in the workspace.
- **Document symbols** outline — `contract` and `operation` declarations show in the breadcrumb / outline panel
- **Workspace symbols** (Cmd+T) — jump to any contract, route, or service declaration across the workspace, filtered by query
- **Document formatting** — Format Document runs the ContractKit prettier printer over the file
- **Document links** — Cmd+click on `https://`, `file://`, and relative `./` paths inside string literals (e.g. plugin extension templates)
- **Folding ranges** — collapse `contract`, `operation`, `options`, and inline object blocks; consecutive comment lines fold as a region
- **Find all references / Document highlights** — right-click → Find All References, or Cmd+F2 to highlight every occurrence of a model or service name in the current document
- **CodeLens reference counts** — every model and service declaration shows a "N references" lens that opens the references peek view on click
- **Rename Symbol** (F2) — renames a model or service across every file in the workspace. Validates the new name is a legal ContractKit identifier and rejects collisions with existing symbols.
- **Code Actions** — quick-fixes for `missing-override` (insert `override`), `spurious-override` (remove `override`), and `unknown-model` (offer fuzzy-matched name suggestions) diagnostics
- **Signature help** — parameter docs inside scalar constraint calls like `string(min=...)`, `int(min, max)`, `discriminated(by=...)`
- **Inlay hints** — show inherited field names next to a model declaration that has bases (e.g. `contract Admin: User & {` displays `+ name, email` inline)
- **Semantic tokens** — precise classification of keywords, modifiers, scalar types, model names (as `class`), and service names (as `interface`) for richer highlighting
- **Live diagnostics** — parser errors and warnings as you type, now with stable diagnostic codes that quick-fixes dispatch on
- **Cross-file model index** — referenced models from other open `.ck` files participate in completion and hover

Requires VS Code or Cursor 1.105.1+.

## Installation

The extension is workspace-internal and built/installed from source:

```bash
# From the repo root
pnpm run vscode:install

# To uninstall
pnpm run vscode:uninstall
```

The install script packages the extension with `vsce`, then installs the resulting `.vsix` into the local `code` (or `cursor`) binary.

## Architecture

The extension is split into a thin client and a Language Server, communicating over LSP.

| Path | Purpose |
| --- | --- |
| `syntaxes/ck.tmLanguage.json` | TextMate grammar for highlighting (must stay in sync with `contractkit.ohm` from `@contractkit/core`) |
| `language-configuration/ck-language-config.json` | Brackets, comments, auto-closing pairs |
| `src/client/extension.ts` | LSP client — boots the server and registers the `contract-ck` language |
| `src/server/server.ts` | LSP server entry — wires document manager + providers + diagnostics |
| `src/server/document-manager.ts` | Re-parses each open document; drives diagnostics |
| `src/server/workspace-index.ts` | Cross-file index of `contract` and `operation` declarations |
| `src/server/completion-provider.ts` | Context-aware completion (types, keywords, model refs) |
| `src/server/hover-provider.ts` | Hover info for types and model refs |
| `src/server/definition-provider.ts` | Go-to-definition on identifiers |
| `src/server/symbol-provider.ts` | Document symbols (outline) |
| `src/server/workspace-symbol-provider.ts` | Workspace symbols (Cmd+T) — models, routes, service declarations |
| `src/server/formatting-provider.ts` | Document formatting via `@contractkit/prettier-plugin` |
| `src/server/document-link-provider.ts` | Cmd+clickable URLs and relative paths inside string literals |
| `src/server/folding-provider.ts` | Folding ranges for brace-delimited blocks and comment runs |
| `src/server/references-provider.ts` | Find references and document highlights, backed by `WorkspaceIndex`'s textual reference scan |
| `src/server/codelens-provider.ts` | "N references" CodeLens above each model and service declaration |
| `src/server/rename-provider.ts` | F2-rename for models and services across the workspace |
| `src/server/code-action-provider.ts` | Quick-fixes dispatched off `Diagnostic.code` |
| `src/server/signature-help-provider.ts` | Parameter help inside scalar constraint calls |
| `src/server/inlay-hint-provider.ts` | Inherited-field hints next to model declarations |
| `src/server/semantic-tokens-provider.ts` | Semantic-token classification for richer highlighting |
| `src/server/diagnostics-adapter.ts` | Converts `@contractkit/core` `Diagnostics` to LSP diagnostics |

## Maintaining the syntax grammar

The TextMate grammar must accept the same character classes as the Ohm parser. When `packages/contractkit/src/contractkit.ohm` changes, update `syntaxes/ck.tmLanguage.json` accordingly and re-run `pnpm run vscode:install` to reload locally.
