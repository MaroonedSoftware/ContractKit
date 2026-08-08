---
'@contractkit/core': minor
'@contractkit/prettier-plugin': minor
---

Allow a comment above `options`, and a trailing comment on an options entry.

A `#` comment above a `contract` or `operation` has always been fine, but one above the `options` keyword was a parse error — a file header is a natural thing to write, and writing it broke the build. `OptionsBlock` now owns the leading `comment*`. It lives there rather than on `Root` deliberately: on `Root` its greedy match would swallow the doc comment above a `contract` in a file that has no options block at all.

A trailing comment on a `keys`/`services` entry was worse than unsupported: it was swallowed into the value, and because an unquoted value ends at the first `}`, a comment containing one — `# interpolated as {{area}}` — closed the block early and silently mis-parsed the rest of the file. The value now ends at whitespace-then-`#`, and the comment is retained so the formatter round-trips it. A `#` with no space before it still belongs to the value, so the unquoted subpath form (`PetService: #modules/pet/pet.service.js`) is unaffected.

The TextMate grammar had the matching gap: its unquoted-value pattern accepted identifiers only, so an unquoted subpath fell through to the comment pattern and was coloured as though the parser ignored it.
