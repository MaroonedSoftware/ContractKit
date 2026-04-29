# ContractKit (VS Code extension)

Language support for ContractKit `.ck` contract files in VS Code and Cursor. Includes syntax highlighting, completion, hover, go-to-definition, document symbols, and live diagnostics from a Language Server.

## Features

- **Syntax highlighting** via TextMate grammar (`syntaxes/ck.tmLanguage.json`)
- **Auto-completion** for built-in types, modifiers, keywords, HTTP methods, content types, security blocks, and cross-file model references
- **Hover information** for built-in types and referenced models
- **Go-to-definition** on model references — jumps to the `contract` declaration in any open file
- **Document symbols** outline — `contract` and `operation` declarations show in the breadcrumb / outline panel
- **Live diagnostics** — parser errors and warnings as you type
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
| `src/server/diagnostics-adapter.ts` | Converts `@contractkit/core` `Diagnostics` to LSP diagnostics |

## Maintaining the syntax grammar

The TextMate grammar must accept the same character classes as the Ohm parser. When `packages/contractkit/src/contractkit.ohm` changes, update `syntaxes/ck.tmLanguage.json` accordingly and re-run `pnpm run vscode:install` to reload locally.
