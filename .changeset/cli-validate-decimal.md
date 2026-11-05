---
'@contractkit/core': minor
'@contractkit/cli': minor
---

`contractkit` now fails the build on a `decimal` in an undiscriminated union or a `decimal` response header. These checks ran only in the editor, so a CLI build accepted both. Core now exports `validateDecimal`.
