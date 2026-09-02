# @contractkit/plugin-docs

## 0.2.1

### Patch Changes

- 96e03f0: Removed the deprecated `@contractkit/plugin-openapi` and `@contractkit/plugin-markdown` packages
  from the workspace. Both shipped a final 1.0.0 that re-exported the corresponding plugin-docs target
  and carried a migration note, so anyone still on them keeps working on that version; there will be
  no further releases of either.

    Documentation that described them as separate plugins now documents `openapi` and `markdown` as
    targets of `@contractkit/plugin-docs`, including their full option tables.

## 0.2.0

### Minor Changes

- f75dd1d: Split the Models navigation group by area, and add `markdown` and `openapi` targets alongside
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

- e9fb23f: Initial release. Generates a deployable Mintlify documentation site from `.ck` files: an OpenAPI
  spec, one MDX page per endpoint and per documented model, a `docs.json` navigation file, and a
  write-once starter landing page.

    Pages carry only frontmatter — Mintlify renders parameters, schemas and the interactive playground
    from the spec. `docs.json` is regenerated every build so navigation cannot drift from the contracts;
    site settings and hand-written navigation go in the plugin's `docs` option and are merged around the
    generated API reference.

    The `target` option selects the documentation platform. `mintlify` is the only value today.
