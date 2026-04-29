# @contractkit/prettier-plugin

A [Prettier](https://prettier.io) plugin that formats ContractKit `.ck` files. Idempotent: re-formatting an already-formatted file is a no-op.

## Installation

```bash
pnpm add -D prettier @contractkit/prettier-plugin
```

## Configuration

Add the plugin to your prettier config:

```json
{
    "plugins": ["@contractkit/prettier-plugin"]
}
```

Prettier registers `.ck` as the `ContractDSL` language and applies the plugin automatically.

## Usage

```bash
# Format all .ck files in your project
pnpm prettier --write "**/*.ck"

# Or via the editor integration of your choice
```

Most editors with a Prettier integration (VS Code, JetBrains, Neovim) pick the plugin up from your project's `package.json` automatically.

## What it does

The printer round-trips the parser's AST back into canonical `.ck` source:

- 4-space indentation (matches Prettier's default `tabWidth`)
- Canonical modifier order on fields: `override → deprecated → readonly|writeonly`
- Stable ordering of `options` block items, route bodies, and operation blocks
- Inline `# comment` placement preserved on field/operation/status lines
- Multi-base inheritance: `contract C: A & B & { ... }` with the inline block always last
- Multi-line unions: a leading `|` is preserved on type aliases like `contract X: A | B | C`
- Discriminated unions render as `discriminated(by=field, A | B | C)`
- Options-level header globals (`options { request/response: { headers } }`) are emitted in their original un-merged form so the AST round-trips cleanly

The plugin honours Prettier's `printWidth` for line-wrapping decisions where applicable, but most CK constructs format to a fixed multi-line shape regardless of width.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Prettier plugin entry — parser + printer registration |
| `src/print-ck.ts` | Top-level dispatcher; renders the `options { ... }` block |
| `src/print-contract.ts` | Renders `contract` declarations and field blocks |
| `src/print-operation.ts` | Renders `operation` declarations, params, query, headers, request/response |
| `src/print-type.ts` | Shared type-expression printer used everywhere a type appears |
| `src/indent.ts` | Indentation constants and helpers |
