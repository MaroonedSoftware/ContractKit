---
name: ck-grammar-change
description: Checklist and conventions for changing the ContractKit Ohm grammar (contractkit.ohm) — which downstream files must move in lockstep (semantics, AST, TextMate grammar, prettier printer, every codegen plugin, CLI, README) and how to verify the change. Use whenever adding or altering `.ck` syntax.
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
4. `apps/prettier-plugin/src/print-*.ts` — round-trip the new syntax, plus a round-trip test
   in `apps/prettier-plugin/tests/print-ck.test.ts`.
5. `packages/contractkit/tests/parser-ck.test.ts` — a parser test.
6. **Every codegen plugin that consumes the affected AST shape**, not just the TypeScript
   one. Check each: `plugin-typescript` (server, SDK, Zod, plain types), `plugin-python`,
   `plugin-openapi`, `plugin-markdown`, `plugin-bruno`, and `openapi-to-ck` (the reverse
   direction). Update codegen *and* tests for each.
7. `apps/cli` — if file discovery, config schema, or cache fingerprinting is affected.
8. `README.md` — if the surface syntax changed.

## Verify

```bash
pnpm test
```

Run it at the workspace root. Every package must pass before the change is done.
