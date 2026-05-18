---
'@contractkit/explorer-ui': minor
---

`renderOperation` accepts a new `collapsible` option that emits the card as an open `<details>` with the header row as its `<summary>`. The single-file detail page now uses this when a file declares more than one operation, so each route can be folded individually.
