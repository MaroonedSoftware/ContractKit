---
'@contractkit/plugin-docs': minor
---

Split the Models navigation group by area, and add `markdown` and `openapi` targets alongside
`mintlify`.

Targets are configured as sub-configs, each enabled by being present, the way plugin-typescript
turns on `server` / `sdk` / `mcp`. The CLI keys its plugins block by package name, so a single
`target` string would have allowed only one documentation format per build.

All three targets now share one implementation of titles, slugs and area grouping. Two output
changes come with that: page titles are sentence case rather than Title Case, which stops a
description-length title reading as "Look Up A Refund By Its Originating Payment", and models with
an `area` become a nested subgroup under `Models`, written to `<modelsDir>/<area>/`. Models from
files with no area stay directly under `Models`, so a project declaring no areas keeps its flat
list. The Markdown output is byte-identical.

With both `mintlify` and `openapi` configured, and the spec landing inside the docs folder, one
spec is emitted and the pages point at it rather than a second copy being written.

Note all three outputs now report as plugin `name: 'docs'`, which changes their cache keys and the
plugin prefix on warnings.
