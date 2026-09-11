# @contractkit/plugin-docs

## 0.4.1

### Patch Changes

- 153134e: A default on a `bigint` field is parsed as an exact `bigint`, and the generated TypeScript for one compiles.

    `quantity: bigint = 9007199254740993` used to parse to the JS number `9007199254740992`, so every generator emitted the rounded value and `pnpm format` wrote it back into the file. The parser now reads the literal's digits into a `bigint`, for a `bigint` field or a `bigint | null` one. A non-integer default such as `= 1.5` is reported as an error instead. `FieldNode.default` and `OpParamNode.default` are typed `FieldDefault`, which adds `bigint`, so plugins that read a default have one more case to handle. The new `coerceDefault` export applies the rule.

    The TypeScript plugin wrote a bigint default as `.default(5)`. Zod requires a default to be the schema's output type, so every generated project with a bigint default failed to typecheck (TS2769). At runtime the handler would also have received a `number`, because Zod returns a default without parsing it. It now writes `.default(5n)`.

    Every other consumer handles the new value: Kotlin, Swift and C# initialize from the exact digits, Bruno and the `openapi` target write the digit string a `bigint` travels as, `openapi-to-ck` reads that string back with `BigInt()` rather than `Number()`, and the VS Code hover no longer throws when a referenced model carries a bigint default.

    A default on a field whose type is a `ref` to a `bigint` alias is still parsed as a number, because the alias is not resolved at parse time.

- cdc4683: The `openapi` target quotes a string that a YAML parser would otherwise read as a number.

    Only a leading digit triggered quoting, so a string such as `-9007199254740993`, `-0.10` or `.5` was written bare, and every YAML reader resolved it as a number. A negative `bigint` bound in `x-contractkit-min` came back rounded to a float, a negative `decimal` bound came back as a number instead of its source text, and a negative `bigint` default became a number on a `type: string` schema. These strings are now single-quoted.

- Updated dependencies [a440886]
- Updated dependencies [153134e]
    - @contractkit/core@0.31.0

## 0.4.0

### Minor Changes

- ba621a7: Document `bigint` as what goes over the wire: a digit string, not a JSON integer.

    The OpenAPI target described a `bigint` as `type: integer, format: int64`, but no ContractKit client sends a number for one. The TypeScript SDK writes `"123n"`, the Kotlin, Swift, C# and Python SDKs write `"123"`, and the generated server's schema rejects a JSON number. A third-party client generated from the spec therefore sent a number and had its request rejected, and the server's own responses failed validation against the spec. A `bigint` is now `type: string, format: bigint, pattern: '^-?\d+n?$'`. The pattern accepts both forms every ContractKit client reads, and rejects a number, a decimal or anything else. `format: bigint` rather than `int64` because the value is unbounded, and a generator keyed on `int64` alone could still map it to a 64-bit number. Bounds go in `x-contractkit-min` / `x-contractkit-max`, as `decimal`'s already do, since `minimum`/`maximum` are ignored on a string. A field default is written as a string so the schema accepts it. `@contractkit/openapi-to-ck` reads the new form back as `bigint`.

    The Markdown target and the Docusaurus target that shares its renderer keep `bigint` in the type column and add _sent as a digit string, "123" or "123n"_ to the description, including under a `bigint` type alias. Mintlify pages render from the emitted OpenAPI, so they pick up the new schema directly.

    **Minor rather than patch, because the published spec changes shape.** Anything generated from an earlier spec had `bigint` fields as integers, and needs regenerating to talk to a ContractKit server, which it could not do before either.

## 0.3.2

### Patch Changes

- b0f3778: Published builds no longer wrap every function in a `__name()` call, so a bundler can drop the
  exports it does not use. The shared tsconfig enabled `emitDecoratorMetadata`, which made tsup compile
  through swc with `keepNames` forced on, and nothing in the repo uses decorators. `@contractkit/core`
  shrinks by about 7%, and anything that bundles it, the VS Code extension included, no longer
  carries core functions it never calls.
- Updated dependencies [b0f3778]
    - @contractkit/core@0.30.1

## 0.3.1

### Patch Changes

- 65d85b5: Four fixes found by running the docs targets against a real project's 125 contracts.

    The OpenAPI document is valid YAML again, which on that project it was not: 419 parser errors from
    two causes, both inherited by the Mintlify target, which renders from that spec.
    - A description spanning several lines was single-quoted with its line breaks written raw, so the
      next line started at column 0. A string carrying a line break or another control character is
      now written as a double-quoted scalar, which stays on one line and keeps the break.
    - An empty object value, such as the `additionalProperties: {}` a `record(any)` produces, was
      treated as a nested block and written on the line after its key with no indentation. It is now
      written inline, as an empty array already was.

    The "SDK method" note on the Markdown and Docusaurus pages now names the method the TypeScript SDK
    actually generates. It skipped the `name:` step of the SDK's naming priority
    (`sdk:`, then `name:`, then verb and path), so an operation named `Request token` was documented as
    `postAuthToken` while the SDK exposes `requestToken`.

    Security stated once in a file's `options` block now reaches the documentation. Every target
    resolved an operation's security from the operation and its route but never the file, which the
    routers do honour, so a contract that sets its floor once, the pattern the language recommends,
    had most of its operations documented with no security at all (97 of 172 endpoint pages on that
    project), and a file-wide `security: none` was not marked public in the OpenAPI document.

- Updated dependencies [17f4261]
    - @contractkit/core@0.30.0

## 0.3.0

### Minor Changes

- 43c3778: Added a `docusaurus` target, alongside the existing `openapi`, `markdown` and `mintlify` ones. It
  emits a folder that drops straight into a stock `@docusaurus/preset-classic` `docs/` directory:
  one Markdown page per public endpoint and per reachable model, a starter `index.md`, and the
  `_category_.json` files the autogenerated sidebar reads for labels and ordering. Nothing needs
  installing or configuring on the site, and there is no OpenAPI spec in the middle — unlike the
  Mintlify pages, which are frontmatter pointing at a spec, these carry their whole body.

    Every page carries the `mdx.format: md` frontmatter. Docusaurus parses `.md` as MDX by default,
    which would reject the `<details>` blocks, the `<br>` inside table cells and any unescaped `{` in
    a description; the opt-in is per file, so a site needs no `markdown.format` setting and its own
    MDX pages are untouched. Model references are emitted as relative file links, so a broken one
    fails the site build rather than rendering as a dead anchor, and every generated category carries
    an explicit `link` — without one Docusaurus promotes any doc named `index`, `readme`, or the same
    as its folder into the category's landing page and drops it from the sidebar, which would silently
    lose a model named `Models`.

    The target shares the `markdown` target's renderer rather than duplicating it. The two differ
    only in a `MarkdownDialect`, which decides how a callout is written and where a model reference
    links to; `renderEndpointBody`, `renderModelBody`, `githubDialect` and `buildModelIndex` are now
    exported for it.

    One change falls out of that sharing: a deprecated model in the `markdown` target now renders as a
    `> [!WARNING]` alert, matching how a deprecated endpoint has always rendered there, instead of a
    plain bold blockquote. A multi-line model description is also quoted line by line, where before
    everything after the first line escaped the block quote.

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
