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

The printer round-trips the parser's AST back into `.ck` source:

- 4-space indentation (matches Prettier's default `tabWidth`)
- Canonical modifier order on fields: `override → deprecated → readonly|writeonly`
- Multi-base inheritance: `contract C: A & B & { ... }` with the inline block always last
- Multi-line unions: a leading `|` is preserved on type aliases like `contract X: A | B | C`
- Discriminated unions render as `discriminated(by=field, A | B | C)`
- Options-level header globals (`options { request/response: { headers } }`) are emitted in their original un-merged form so the AST round-trips cleanly

The plugin honours Prettier's `printWidth` for line-wrapping decisions where applicable, but most CK constructs format to a fixed multi-line shape regardless of width.

## What it preserves

Formatting a well-formed `.ck` file leaves it byte-identical. The formatter deliberately does **not** impose a canonical layout where the language allows more than one form — it reproduces what the author wrote:

- **Comment placement.** A `#` block separated from the declaration below it by a blank line stays a standalone divider; one directly above becomes that declaration's doc comment and is re-emitted above it, not folded onto the header line. A comment written inline (`contract Pet: { # ...`) stays inline.
- **Operation body key order.** `sdk` before `service` stays that way; the printer never sorts a user's keys into a canonical order.
- **Blank lines** between operations inside a route.
- **Single-line response blocks.** `200: { application/json: Pet }` is not expanded, and an expanded block is not collapsed. A status declaring several mimes on one line stays on one line too.
- **Comments inside a `response` block**, in all four positions: above a status code, above a `mime: Type` line, above a `headers:` block, and before either closing brace.
- **An empty status block.** `304: {}` and `304:` mean different things to codegen — the first says the service returns that status with no body — so neither is normalized into the other.

This is covered by `tests/round-trip.test.ts`, which formats every `.ck` file under `contracts/` and asserts the output is unchanged, plus checks that formatting is a fixed point. Anything that makes the printer normalize rather than preserve will fail it.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/index.ts` | Prettier plugin entry — parser + printer registration |
| `src/print-ck.ts` | Top-level dispatcher; renders the `options { ... }` block |
| `src/print-contract.ts` | Renders `contract` declarations and field blocks |
| `src/print-operation.ts` | Renders `operation` declarations, params, query, headers, request/response |
| `src/print-type.ts` | Shared type-expression printer used everywhere a type appears |
| `src/indent.ts` | Indentation constants and helpers |
