---
name: ck-grammar-change
description: Checklist and conventions for changing the ContractKit Ohm grammar (contractkit.ohm) — which downstream files must move in lockstep (semantics, AST, TextMate grammar, the core `.ck` printer, every codegen plugin, CLI, README) and how to verify the change. Use whenever adding or altering `.ck` syntax.
---

# Changing the grammar

## Ohm conventions (`contractkit.ohm`)

- **PascalCase rules** are syntactic — Ohm auto-skips whitespace.
- **camelCase rules** are lexical — no whitespace skipping.
- Keywords must be lexical rules with `~identPart` guards, or whitespace skipping inside
  syntactic rules will let them match partial identifiers.

## What must move with it

A grammar change is never a one-file change. Work through all of these explicitly:

1. `semantics.ts` — the corresponding action.
2. `ast.ts` — the AST node type.
3. `apps/vscode-extension/syntaxes/ck.tmLanguage.json` — the highlighting regex must accept
   the same characters the parser does. Reload locally with `pnpm run vscode:install`.
4. `apps/vscode-extension/src/server/completion-provider.ts` — it decides what block the
   cursor is in by regex-matching the text before the enclosing `{`. New syntax between a
   keyword and its colon (a modifier, say) makes that match fail, and completions silently
   stop working inside the block with no error anywhere.
5. `packages/contractkit/src/print/` — **the one `.ck` printer**, used by the prettier plugin
   and by `openapi-to-ck` alike. Round-trip the new syntax, plus a round-trip test in
   `packages/contractkit/tests/round-trip.test.ts`. Anything the printer does not know about
   is *deleted* from the user's file on the next `pnpm format`, comments included — so a
   construct is not done until it round-trips.

   The printer must stay correct for **programmatically built** nodes, not just parsed ones.
   `openapi-to-ck` hands it ASTs that `parseCk` could never produce — a description containing
   newlines, a regex containing `/`, a string carrying both quote styles — and printing those
   naively emits source that does not parse. Reach for `inlineComment`, `quoteString` and
   `printRegex` in `print-type.ts` rather than interpolating a raw value into the output.
6. `packages/contractkit/tests/parser-ck.test.ts` — a parser test.
7. **Every codegen plugin that consumes the affected AST shape**, not just the TypeScript
   one. Check each: `plugin-typescript` (server, SDK, Zod, plain types), `plugin-python`,
   `plugin-docs` (all four targets — `openapi`, `markdown`, `mintlify`, `docusaurus`),
   `plugin-bruno`, and `openapi-to-ck` (the reverse direction). Update codegen *and* tests for
   each. In `plugin-docs` the four targets share `src/naming.ts` for titles, slugs and area
   grouping, so a change there moves every documentation output at once; `markdown` and
   `docusaurus` further share the renderer in `targets/markdown/codegen.ts`, which they vary only
   through the `MarkdownDialect` seam, so a change to an endpoint or model body shows up in both.
   `openapi-to-ck` does not print `.ck` itself — it builds core AST nodes and hands them to
   `printCk` — so what it needs is a *producer* for the new construct, not a serializer.
8. `apps/cli` — if file discovery, config schema, or cache fingerprinting is affected.
9. `README.md` — if the surface syntax changed.

## Verify

```bash
pnpm test
```

Run it at the workspace root. Every package must pass before the change is done.
