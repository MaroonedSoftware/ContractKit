---
'@contractkit/core': minor
'@contractkit/prettier-plugin': patch
'@contractkit/openapi-to-ck': patch
---

Move the `.ck` printer into core, so the language has exactly one

`.ck` had two printers: the prettier plugin's `printCk` and a hand-rolled one inside
`openapi-to-ck`. Only the prettier copy was covered by the round-trip tests that the grammar
checklist points at, so the other silently fell behind the grammar — it ignored `hasBlock` and
the `(documented)` response modifier, could not emit `mcp:`, `plugins:`, `name:`, `override`,
`format(output=)` or options-level header globals, and emitted source that does not parse for a
regex containing `/` or an enum value carrying both quote styles.

`printCk` now lives in `@contractkit/core` next to `parseCk` and is exported from it. The
prettier plugin re-exports it unchanged, and `openapi-to-ck`'s `astToCk` is a thin adapter over
it, so all of the above now print correctly.

Three printing fixes come with the move, all of which affect `pnpm format` on existing files:

- A regex containing `/` prints as `regex="…"` instead of an unterminated regex literal.
- A string containing `"` prints single-quoted; one carrying both quote styles is degraded
  rather than emitted unparseable (use the new `isUnquotable` to warn before printing).
- A description containing newlines is flattened when it prints as a trailing `# …` comment,
  instead of leaking the remainder as raw source.

Files containing any of these currently cannot round-trip at all, so this is a fix rather than a
break. `openapi-to-ck` output changes shape in two ways: model descriptions now print as a
doc-comment block above the `contract` rather than as a trailing comment, and scalar constraints
use the canonical `len=` / positional `format` spellings.
