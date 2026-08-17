# @repo/docs-images

Renders the figures used by the README and `docs/` into `assets/figures/`, as SVG.

Private to the repo — it ships nothing, and no published package depends on it.

```bash
pnpm docs:images     # from the repo root
```

## Why the figures are generated

Two problems this solves, both of which bite documentation that is read on GitHub:

- **GitHub cannot syntax-highlight `.ck`.** A fenced block tagged ` ```ck ` renders as grey text,
  which sells the language badly. These figures colour it with
  `apps/vscode-extension/syntaxes/ck.tmLanguage.json` — the extension's own TextMate grammar —
  through Shiki, using VS Code's own Dark+ and Light+ themes. What the reader sees in the README
  is what the editor will show them.
- **Screenshots rot.** Every code figure is sliced out of a real, checked-in contract under
  `contracts/`, which `packages/contractkit` validates as a project in its test suite. Change a
  contract or the grammar, re-run `pnpm docs:images`, and the figures follow. A stale anchor
  fails the render rather than quietly showing the wrong lines.

The editor-feature figures (hover, completion, CodeLens, inlay hints, diagnostics, the Explorer
tree, the API preview panel) are drawn by this package, not captured from a running VS Code. The
code inside them and its colouring are real; the surrounding chrome is drawn to match VS Code's
default themes.

## Layout

| Path                 | Purpose                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `src/highlighter.ts` | Loads the extension's TextMate grammar into Shiki; turns code into positioned, coloured runs |
| `src/svg.ts`         | SVG primitives, the character-grid metrics, and the constraints GitHub imposes               |
| `src/palette.ts`     | Editor chrome colours for the Dark+ / Light+ pairs                                           |
| `src/editor.ts`      | An editor pane: tab bar, gutter, code, hover cards, inlay hints, CodeLens, squiggles         |
| `src/window.ts`      | Composes panes into a window — Explorer sidebar, editor, API preview panel — and frames it   |
| `src/diagram.ts`     | The "one file in, eight artefacts out" figure                                                |
| `src/excerpt.ts`     | Slices a contiguous run of lines out of a contract, anchored on text not line numbers        |
| `src/figures.ts`     | The figure manifest: what each one shows and where it comes from                             |
| `src/render.ts`      | Writes every figure in both themes to `assets/figures/`                                      |

## Constraints worth knowing before editing

The docs are read on GitHub, which loads SVGs through an `<img>` tag. That means:

- **No `<style>` blocks or `class` attributes.** GitHub's sanitizer strips them; everything uses
  presentation attributes.
- **No webfonts.** An `<img>`-rendered SVG cannot fetch one, so code uses a generic monospace
  stack and every run carries `textLength`, which holds the character grid whatever font the
  reader's machine resolves.
- **Two files per figure.** Docs embed them in a `<picture>` with a `prefers-color-scheme` source,
  which is the only theme switching GitHub markdown supports.

`tests/figures.test.ts` enforces the first three; breaking them fails the suite rather than the
reader's browser.
