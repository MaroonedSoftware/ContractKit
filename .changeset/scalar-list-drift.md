---
'@contractkit/plugin-typescript': patch
---

Fix scalar lists that had drifted out of sync with the language

Four places kept a hand-written copy of the language's scalar names, and three had already fallen
behind without anything failing to build:

- The VS Code completion list and hover map were both missing `interval`, so the editor silently
  stopped recognising it — no completion, no hover.
- The constraint-argument regex that decides when to offer `min=`/`max=` completions was missing
  `time`, `interval`, and every non-constrainable scalar.
- `docs/language.md`'s scalar table was missing `duration`.

The completion and semantic-token providers now read `SCALAR_NAMES` from `@contractkit/core`
directly, which removes the drift class rather than patching this instance of it, and the
constraint regex is built from those lists. What genuinely cannot derive from the set — a TextMate
alternation, a per-scalar documentation map, a Markdown table — is now covered by a test that fails
when any of them falls behind.

Also fixes the SDK scaffold's luxon detection, which omitted `duration`. `generateContract` imports
`Duration` from luxon whenever that scalar is present, so a contract whose only temporal type was a
duration scaffolded a `package.json` with no `luxon` dependency and did not compile.
