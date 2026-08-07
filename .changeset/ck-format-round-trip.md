---
'@contractkit/core': minor
'@contractkit/prettier-plugin': minor
---

Fix the formatter rewriting `.ck` files it should have left alone. Running Prettier on a contract folded standalone `#` comment blocks into a trailing comment on the following declaration (`# ─── Pet endpoints ───` became `operation /pet: { # ─── Pet endpoints ───`), reordered operation body keys into a canonical order, dropped blank lines between operations, and expanded single-line response bodies like `200: { application/json: Pet }` onto three lines. An inline contract comment (`contract Pet: { # A pet`) was also attributed to the first field, so it printed twice.

The parser now records the author's layout alongside the semantics — comment placement (`leadingComments`, `descriptionInline`), operation body key order (`keyOrder`), blank lines (`blankLineBefore`), and single-line response blocks (`inline`) — and the printer reproduces it. A `#` comment separated from the declaration below it by a blank line is a standalone divider rather than a doc comment; one written directly above is a doc comment and is emitted above the declaration, not on its header line.

Comments may now also sit directly inside an `options { ... }` block, between its sub-blocks, where the grammar previously rejected them.

These AST fields are additive and optional; codegen plugins ignore them.
