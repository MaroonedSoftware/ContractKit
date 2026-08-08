---
'@contractkit/core': minor
'@contractkit/prettier-plugin': patch
---

Stop the formatter deleting comments in and around a `security { }` block, and keep the trailing newline at end of file.

The identical bug in `response { }` was fixed in 0.14.0; this position was not covered. `SecurityBody_fields` skipped standalone comments outright, so a `#` run inside a security block never reached the AST and `pnpm format` deleted it with no warning — exactly the prose that records *why* a policy floor sits where it does. Three more positions failed the same way and now round-trip:

- a comment run above a body key in an operation body (the common case being a note above the `security:` key, or above `security: none`, explaining why a verb overrides the file's floor);
- a comment run above a verb that also carries its own inline `# ...` doc comment — the inline comment won and the run above it was discarded;
- a comment left after the last key in an operation body, before the closing brace.

`SecurityPolicyLine` and `SecuritySignatureLine` no longer take a trailing `comment?`. Whitespace skipping in an Ohm syntactic rule crosses newlines, so that optional comment swallowed a standalone comment written on the *next* line and re-emitted it as the policy's inline description — turning a note to the next contract author into generated SDK documentation. `SecurityBody_fields` now collects every comment and decides which one is inline by comparing source lines, the same way `FieldList` already does.

The same newline-crossing optional appeared on `ModelBody_alias`, where it was worse: it claimed the doc comment of the *next* declaration. `contract Status: enum(a, b)` followed by a documented contract either lost that doc comment outright, or silently re-filed it as `Status`'s own description — which then flowed into generated SDK docs describing the wrong type. Declaration-level comments are now items in `Root` (`DeclItem`) rather than a `comment*` prefix on each declaration, so their placement is decided where the previous declaration's end line is known: same line as the declaration above → its inline description; directly above the next one → its doc comment; otherwise a standalone block. A comment after the last declaration in a file used to be a parse error and is now kept as `CkRootNode.trailingComments`.

Two field positions were lost the same way. A comment on a nested object's opening brace (`rp: { # The relying party`) was offered to the first field *inside* the object and dropped when that field had its own comment; it now belongs to the field owning the brace. A trailing comment on a field whose type wraps over several lines — `enum(\n  a,\n  b\n) # note` — was compared against the line the field *started* on, so it was filed as a standalone comment for the next field; it now compares against the line the field ends on.

`SecurityFields` gains `leadingComments` / `trailingComments`, `OpOperationNode` gains `bodyLeadingComments`, `bodyTrailingComments`, and `leadingComments`, and `CkRootNode` gains `trailingComments`. All are optional and additive, so codegen plugins are unaffected.

### `#` where it is not a comment

`nameText` ended a name at any `#`, so `name: Generate C# client` silently became `Generate C` and the rest vanished with no diagnostic. It now ends at whitespace-then-`#`, matching `optionsRawChar` — a bare `#` is data, and only ` #` opens a comment. That makes the two unquoted-text positions in the language consistent with each other. The TextMate `name-decl` pattern captured the whole rest of the line, colouring a trailing comment as part of the name; it now stops at the same boundary the parser does.

Note that a `name:` containing a bare `#` now parses to its full text, and the SDK method name is derived from `name:` — so a contract that was silently relying on the truncated value will see that method renamed. Only a name with a `#` in it is affected.

Separately, the prettier plugin trimmed the printed source and returned it without re-adding a terminator, so every formatted `.ck` file lost its trailing newline — fighting any editor or lint rule that wants one. The plugin now has end-to-end tests that go through prettier itself rather than calling `printCk` directly, which is the layer where that slipped through.
