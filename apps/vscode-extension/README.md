# ContractKit for VS Code

Language support for `.ck` contract files in VS Code and Cursor: syntax highlighting, a language
server that indexes your whole workspace, and an API explorer that renders your contracts as
browsable documentation you can send requests from.

Requires VS Code or Cursor 1.105.1+.

## Install

The extension is workspace-internal and built from source:

```bash
# From the repo root
pnpm run vscode:install
```

That packages the extension with `vsce` and installs the resulting `.vsix` into your local `code`
(or `cursor`) binary. To remove it:

```bash
pnpm run vscode:uninstall
```

## What you get

### Browse the whole API

The **ContractKit Explorer** in the sidebar lists every endpoint and model across the workspace.
Group it by file, area, or HTTP method, filter it by path, name, `sdk`, or `service`, and it
remembers your choice per workspace. Groups carry a badge when something in them has a warning.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-explorer-dark.svg">
  <img alt="The ContractKit Explorer in the sidebar, listing every endpoint in the workspace grouped by area, beside the contract source." src="../../assets/figures/vscode-explorer-light.svg" width="816">
</picture>

Right-click any node for **Reveal in Editor**, **Copy Path** (`METHOD /route`), or **Copy as cURL**.

### Preview an endpoint, and send it

Click an endpoint to open a detail panel beside the editor: description, params, request and
response schemas with inline-expandable model refs, security badges, and plugin extensions. It
refreshes as you type. `description:` blocks render as Markdown — headings, lists, fenced code,
links.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-preview-dark.svg">
  <img alt="The API preview panel for POST /orders, showing its security policy, headers, request body and four declared responses beside the contract source." src="../../assets/figures/vscode-preview-light.svg" width="833">
</picture>

Every operation card includes a **Try it out** form, prefilled from the schema's path params,
query, headers, and JSON body. Requests are sent from the extension host with Node `fetch`, so
they are not subject to browser CORS, and the status, headers and body come back in place. Set a
default base URL with `contractkit.tryItOut.baseUrl`.

### Understand a model without leaving the file

Hover a model reference to see its declaration and doc comment, wherever in the workspace it was
declared:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-hover-dark.svg">
  <img alt="Hovering the Money type in orders.ck shows its declaration and doc comment from catalog.ck." src="../../assets/figures/vscode-hover-light.svg" width="698">
</picture>

Inheritance is spelled out inline, and every model and service declaration carries a reference
count that opens the peek view on click:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-inlay-hints-dark.svg">
  <img alt="Inlay hints listing the fields User and Admin inherit from their bases, with a reference count above each contract declaration." src="../../assets/figures/vscode-inlay-hints-light.svg" width="620">
</picture>

### Catch mistakes as you type

Parser errors and warnings appear live, with stable diagnostic codes that quick-fixes dispatch on:
`unknown-model` offers fuzzy-matched suggestions, `missing-override` inserts `override`, and
`spurious-override` removes it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-diagnostics-dark.svg">
  <img alt="A misspelled model reference underlined as you type, with a quick fix offering the closest matching name." src="../../assets/figures/vscode-diagnostics-light.svg" width="519">
</picture>

Completion covers built-in types, modifiers, keywords, HTTP methods, content types, security
blocks, and model references from every indexed file — not only the open one:

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../../assets/figures/vscode-completion-dark.svg">
  <img alt="Completion listing the payment models declared across the workspace, each labelled with the file it comes from." src="../../assets/figures/vscode-completion-light.svg" width="519">
</picture>

### Navigate and refactor

| Action | What it does |
| --- | --- |
| **Go to Definition** | Jumps from a model reference to its `contract`, or from a `service:` binding to its entry in `options { services { … } }`. Put the cursor on the **method** segment (`foo` in `PaymentsService.foo`) and it jumps into the TypeScript service source itself, resolving the module path through the generated server's `package.json` `imports` map or the nearest `tsconfig.json` `paths` |
| **Find All References** / **Document Highlights** | Every occurrence of a model or service name, across the workspace |
| **Rename Symbol** (F2) | Renames a model or service everywhere, rejecting illegal identifiers and collisions |
| **Workspace Symbols** (Cmd+T) | Any contract, route, or service declaration, filtered by query |
| **Document Symbols** | `contract` and `operation` declarations in the outline and breadcrumbs |
| **Document Links** | Cmd+click `https://`, `file://`, and relative `./` paths inside string literals |
| **Folding** | `contract`, `operation`, `options` and inline object blocks; runs of comments fold as a region |
| **Format Document** | Runs the ContractKit prettier printer over the file |
| **Signature help** | Parameter docs inside constraint calls like `string(min=…)` or `discriminated(by=…)` |
| **Semantic tokens** | Classifies keywords, modifiers, scalars, models (as `class`) and services (as `interface`) for highlighting that follows meaning, not just shape |

A status bar entry on the left shows the API title, endpoint and model counts, and a warning badge;
clicking it opens the preview.

## Settings

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `contractkit.tryItOut.baseUrl` | `string` | `""` | Base URL prefilled into the Try-it form for every operation (e.g. `https://api.example.com`). Leave blank to require manual entry per request. |

## Commands

| Command | Title | Notes |
| --- | --- | --- |
| `contractkit.previewApi` | ContractKit: Open API Preview | Reveals the tree view and opens the overview |
| `contractkit.refreshExplorer` | ContractKit: Refresh Explorer | Forces the LSP server to re-walk every `.ck` file from disk, then re-fetches the snapshot. Also a title-bar button on the Explorer view and on every preview panel |
| `contractkit.setGrouping` | ContractKit: Set Grouping… | QuickPick for `file` / `area` / `method` / `flat` (persisted per workspace) |
| `contractkit.filterExplorer` | ContractKit: Filter Explorer… | InputBox; matches path, method, name, sdk, service, group |
| `contractkit.clearExplorerFilter` | ContractKit: Clear Explorer Filter | Resets the filter |

## Architecture

A thin client and a Language Server, over LSP.

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
| `src/server/preview-data-builder.ts` | Builds a `PreviewData` snapshot from the workspace index, ready for the renderer |
| `src/shared/protocol.ts` | LSP method-name constants and shared message types for the API preview |
| `src/client/preview-data-store.ts` | Cached, refreshable PreviewData source consumed by the tree and panel |
| `src/client/api-tree-provider.ts` | `TreeDataProvider` for the Explorer view (grouping, filter, warning badges) |
| `src/client/preview-panel.ts` | Singleton webview panel showing the selected operation/model; proxies Try-it requests |
| `src/client/webview-template.ts` | CSP-locked HTML shell loaded into the preview webview |
| `src/client/status-bar.ts` | Left-aligned status bar entry showing API title + counts |
| `src/client/try-it-handler.ts` | Runs Try-it requests via Node `fetch` and returns truncated, decoded responses |
| `src/client/commands.ts` / `api-item-utils.ts` | Reveal-source / Copy-Path / Copy-cURL helpers (split for testability) |
| `src/webview/main.ts` | Webview entry — receives `PreviewData`, calls `@contractkit/explorer-ui` `renderItemPage`, wires form submission |
| `src/webview/style.css` | VS Code theme overrides that map `--ce-*` tokens onto `var(--vscode-*)` |

## Maintaining the syntax grammar

The TextMate grammar must accept the same character classes as the Ohm parser. When
`packages/contractkit/src/contractkit.ohm` changes, update `syntaxes/ck.tmLanguage.json` to match
and re-run `pnpm run vscode:install` to reload locally.

The grammar has a second consumer: `packages/docs-images` renders every code figure in the
documentation through it, so `pnpm docs:images` shows you what your grammar change looks like
without opening the editor.
