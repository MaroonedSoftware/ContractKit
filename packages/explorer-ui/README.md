# @contractkit/explorer-ui

Pure HTML renderer for a ContractKit API explorer. Takes a normalized `PreviewData` snapshot and produces themable HTML strings — no DOM, no framework. The output runs anywhere an HTML string can be inserted: a VS Code webview, a static site, an Electron window, an iframe in a docs site.

`@contractkit/vscode-extension` is the first consumer and ships an inline preview panel built on top of this package. A future `@contractkit/plugin-explorer` will generate a self-contained static API explorer from the same renderer.

## Installation

```bash
pnpm add @contractkit/explorer-ui
```

## Usage

```ts
import { renderApp, renderItemPage, type PreviewData } from '@contractkit/explorer-ui';

const data: PreviewData = {
    configMeta: { title: 'Payments API', version: '1.0.0' },
    operations: [
        {
            filePath: '/contracts/payments.ck',
            fileGroup: 'payments',
            routePath: '/payments/{id}',
            method: 'get',
            op: { /* OpOperationNode from @contractkit/core */ },
            effectiveModifiers: [],
        },
    ],
    models: [
        {
            filePath: '/contracts/payments.ck',
            model: { /* ModelNode from @contractkit/core */ },
        },
    ],
    warnings: [],
};

// Full sidebar + detail layout (workspace-wide view)
document.body.innerHTML = renderApp(data);

// Or just one item — paired with a host-supplied navigation tree
document.body.innerHTML = renderItemPage(data, { kind: 'operation', id: 'op-get-payments-id-' });
```

Pair the HTML with the bundled stylesheet:

```ts
import '@contractkit/explorer-ui/style.css';
```

…or copy `dist/assets/style.css` into your project and link it.

## Theming

All colors and spacing reference CSS custom properties on `:root`. Override any to retheme:

```css
:root {
    --ce-fg: var(--vscode-foreground);
    --ce-bg: var(--vscode-editor-background);
    --ce-sidebar-bg: var(--vscode-sideBar-background);
    --ce-link: var(--vscode-textLink-foreground);
    --ce-border: var(--vscode-panel-border);
    --ce-code-bg: var(--vscode-textCodeBlock-background);
    /* …method/status colors, badges, warning palette */
}
```

The VS Code extension overrides these to match the active editor theme.

## Data contract

The renderer expects **pre-resolved** data — the consumer is responsible for running ContractKit's normalization passes (`applyOptionsDefaults`, `applyVariableSubstitution`, `decomposeCk`, `resolveModifiers`, `resolveSecurity`) and producing the shape in [`src/types.ts`](src/types.ts):

| Type | Role |
| --- | --- |
| `PreviewData` | Top-level snapshot — `configMeta`, `operations`, `models`, `warnings` |
| `PreviewConfigMeta` | `title`, `version`, optional `description` and `servers[]` |
| `ResolvedOperation` | Operation node + file path + effective modifiers/security + grouping key |
| `ResolvedModel` | Model node + file path |
| `PreviewWarning` | Non-fatal diagnostics (e.g. unresolved `{{var}}` references) |

`@contractkit/core` is a workspace dependency for types only — no runtime imports. An eslint rule (`no-restricted-imports`) enforces this so the bundle stays small in webview consumers.

## Public API

| Export | Returns | Purpose |
| --- | --- | --- |
| `renderApp(data)` | HTML string | Full layout: sidebar nav + detail pane |
| `renderItemPage(data, selection, options?)` | HTML string | Single-item detail page (operation / model / overview) |
| `renderOperation(op, options?)` | HTML string | Operation card with header, parameters, request/response schemas, and an optional Try-it form. `options.ctx` enables inline-ref expansion |
| `renderModel(resolvedModel, ctx?)` | HTML string | Model card with badges and field table |
| `renderFieldRows(fields, ctx?)` | HTML string | Just the field table — exported for reuse in inline-object rendering |
| `renderType(type, ctx?)` | HTML string | Recursive type rendering; `ctx.models` enables inline ref expansion |
| `renderSchemaTree(type, ctx?, options?)` | HTML string | Indented schema field tree with constraints and defaults; supports `exclude` to drop readonly/writeonly fields |
| `renderCodeSamples(op, baseUrl, ctx?)` | HTML string | Curl request + synthesized JSON response example for the right rail; deterministically seeded per operation |
| `renderTryIt(op, baseUrl, ctx?)` | HTML string | Standalone Try-it form, pre-filled with deterministic faker-generated samples (already included by `renderOperation` when configured) |
| `renderMarkdown(input)` | HTML string | Tiny safe Markdown renderer (paragraphs, headings, lists, code, bold/italic, http links) |
| `operationId(op)` / `modelId(name)` | string | Stable anchor ids used by `ItemSelection` |
| `listSelections(data)` | array | Flat list of every selectable item (useful for building a picker) |
| `escapeHtml`, `html`, `raw` | helpers | Tagged-template helpers used internally |

## Inline-expanding model refs

When `RenderContext.models` is provided, `ref` types in operations and models render as collapsible `<details>` blocks containing the model's fields recursively. Cycles are detected via a `visited` set and render as a `↺` indicator. Past `maxDepth` (default 4) refs collapse back to plain links carrying `data-jump-file` / `data-jump-line` attributes so the host can jump to source.

```ts
const ctx = { models: new Map(data.models.map(m => [m.model.name, m])) };
renderType(someTypeWithRefs, ctx);
```

## Host integration

The webview script (or static-site bootstrapper) attaches event delegation to handle:

| Selector | Behavior |
| --- | --- |
| `[data-tryit-action="send"]` | Read the form, post `{type:'sendRequest', request}` to the host, render response |
| `[data-open-model]` | Navigate the detail view to that model's dedicated page |
| `[data-jump-file] / [data-jump-line]` | Post `{type:'reveal', file, line}` to the host (in VS Code, opens the source) |
| `a.ce-ref` | Fallback for unresolved refs — host navigates to the dedicated page |

See [`apps/vscode-extension/src/webview/main.ts`](../../apps/vscode-extension/src/webview/main.ts) for a complete example.

## Why HTML strings, not DOM/JSX?

- **Isomorphic.** Same output in a webview, a static-site generator, a server response, or a test snapshot.
- **No runtime dependencies in consumers.** The webview bundle stays at ~20 KB; a static-site generator emits `index.html` and is done.
- **Easy to snapshot-test.** All 96 tests in this package work on plain strings.
