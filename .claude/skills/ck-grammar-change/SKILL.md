---
name: ck-grammar-change
description: Checklist and conventions for changing the ContractKit Ohm grammar (contractkit.ohm). Which downstream files must move in lockstep (semantics, AST, TextMate grammar, editor completions, the core `.ck` printer, every codegen plugin including Kotlin, Swift and C#, explorer-ui, codegen versions, output-test fixtures, CLI, language docs) and how to verify the change. Use whenever adding or altering `.ck` syntax.
---

# Changing the grammar

## Ohm conventions (`contractkit.ohm`)

- **PascalCase rules** are syntactic — Ohm auto-skips whitespace.
- **camelCase rules** are lexical — no whitespace skipping.
- Keywords must be lexical rules with `~identPart` guards, or whitespace skipping inside
  syntactic rules will let them match partial identifiers.
- **Modifiers attach with no gap**: `httpMethodCall` and `statusCodeCall` are lexical, so
  `get (internal)` and `404 (documented)` are parse errors. The TextMate grammar and the printer both
  assume there is no gap.
- **`space` skips newlines but not comments**, so any block has to admit `comment` explicitly, as in
  `(comment | Field)*`, or a comment inside it is a parse error.
- **A trailing `comment?` in a syntactic rule crosses newlines** and swallows a standalone comment on
  the next line. To keep a comment to its own line, use a lexical rule (`optionsEntryValue`), or collect
  every comment in the parent and compare source lines (`SecurityBody_fields`).

## What must move with it

A grammar change is never a one-file change. Work through all of these explicitly:

1. `semantics.ts`: the corresponding action. Parse-time diagnostics go here through `diag`.
2. `ast.ts`: the AST node type. Keep the authored form when two spellings parse to one meaning
   (`mcp?: boolean | 'exclude' | McpConfigNode`, `hasBlock`), since the printer needs it. A new key in
   an operation body also goes in `OpBodyKey` and `OP_BODY_KEYS`, which carry its source order and the
   comments above it through to the printer. A new scalar goes in `SCALAR_NAMES` and `ScalarTypeNode`;
   the editor's completions and semantic tokens read `SCALAR_NAMES`, while the TextMate grammar in item 3
   has its own list. A new compound type goes in `buildCompoundType` (`type-builders.ts`), since these
   are not grammar rules.
3. `apps/vscode-extension/syntaxes/ck.tmLanguage.json`: the highlighting regex must accept
   the same characters the parser does. Rebuild and install locally with `pnpm run vscode:install`,
   which calls `cursor --install-extension`.
4. `apps/vscode-extension/src/server/completion-provider.ts`: it decides what block the
   cursor is in by regex-matching the text before the enclosing `{`. New syntax between a
   keyword and its colon (a modifier, say) makes that match fail, and completions silently
   stop working inside the block with no error anywhere. Its keyword lists (`OP_BLOCK_KEYWORDS`,
   `COMPOUND_TYPES`) are hand-kept too.
5. `packages/contractkit/src/print/`: **the one `.ck` printer**, used by the prettier plugin
   and by `openapi-to-ck` alike. Round-trip the new syntax, plus a round-trip test in
   `packages/contractkit/tests/round-trip.test.ts`. Anything the printer does not know about
   is *deleted* from the user's file on the next `pnpm format`, comments included — so a
   construct is not done until it round-trips.

   The printer must stay correct for **programmatically built** nodes, not just parsed ones.
   `openapi-to-ck` hands it ASTs that `parseCk` could never produce — a description containing
   newlines, a regex containing `/`, a string carrying both quote styles — and printing those
   naively emits source that does not parse. Reach for `inlineComment`, `quoteString` and
   `printRegex` in `print-type.ts` rather than interpolating a raw value into the output.
6. `packages/contractkit/tests/parser-ck.test.ts`: a parser test.
7. **Every codegen plugin that consumes the affected AST shape**, not just the TypeScript
   one. Check each: `plugin-typescript` (server, SDK, Zod, plain types), `plugin-python`, `plugin-kotlin`,
   `plugin-swift`, `plugin-csharp`,
   `plugin-docs` (all four targets — `openapi`, `markdown`, `mintlify`, `docusaurus`),
   `plugin-bruno`, and `openapi-to-ck` (the reverse direction). Update codegen *and* tests for
   each. In `plugin-docs` the four targets share `src/naming.ts` for titles, slugs and area
   grouping, so a change there moves every documentation output at once; `markdown` and
   `docusaurus` further share the renderer in `targets/markdown/codegen.ts`, which they vary only
   through the `MarkdownDialect` seam, so a change to an endpoint or model body shows up in both.
   `openapi-to-ck` does not print `.ck` itself — it builds core AST nodes and hands them to
   `printCk` — so what it needs is a *producer* for the new construct, not a serializer.
   `packages/explorer-ui` renders AST nodes directly, and `apps/vscode-extension`'s
   `preview-data-builder.ts` feeds it, so check those as well.

   A rule more than one generator needs goes in core, as `response-sets.ts`, `mcp-hints.ts` and
   `sdk-method-name.ts` do, so the generators cannot disagree.
8. `apps/cli`: if file discovery, config schema, or cache fingerprinting is affected. A new cross-file
   validator goes in both `apps/cli/src/cli.ts` and `validate-project.ts`.
9. Each plugin's `*_CODEGEN_VERSION`: bump it when that plugin's output shape changes.
10. `packages/output-tests/tests/fixtures/`: add the construct to a fixture, then review the snapshot
    diff (`pnpm --filter @repo/output-tests exec vitest run -u`). If generated server code calls a new
    runtime symbol, stub it in `tests/ambient.d.ts`.
11. `docs/language.md`, the `README.md` cheat sheet, and `llms-full.txt`, if the surface syntax
    changed. `readme-examples.test.ts` parses the whole-file examples in `README.md` and `docs/*.md`.
12. A changeset for each published package you changed.

## Verify

```bash
pnpm test
```

Run it at the workspace root, where turbo builds first. Every package must pass before the change is
done. A filtered `pnpm --filter` run tests against the other packages' existing `dist/`.

The C#, Swift and Python compile checks skip themselves when the toolchain is missing, and Kotlin has
none, so a clean run on your machine may not have compiled those SDKs. See "Testing" in `AGENTS.md`.
