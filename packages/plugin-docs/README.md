# @contractkit/plugin-docs

> ContractKit's documentation generator. Turns `.ck` contract and operation files into an
> OpenAPI 3.1 spec, a single Markdown reference, a deployable [Mintlify](https://mintlify.com)
> docs folder, or a [Docusaurus](https://docusaurus.io) docs directory.

Loaded by `@contractkit/cli` through `contractkit.config.json`. It consumes the AST produced by
`@contractkit/core`.

## Install

```bash
pnpm add -D @contractkit/cli @contractkit/plugin-docs
```

## Configure

`plugins` is an **object** keyed by package name, not an array.

```json
{
    "rootDir": ".",
    "patterns": ["contracts/**/*.ck"],
    "plugins": {
        "@contractkit/plugin-docs": {
            "mintlify": {
                "baseDir": "docs/",
                "openapi": {
                    "info": { "title": "Acme API", "version": "1.0.0" },
                    "servers": [{ "url": "https://api.acme.com" }]
                },
                "docs": {
                    "theme": "mint",
                    "colors": { "primary": "#0D9373" }
                }
            }
        }
    }
}
```

Each key under the plugin is one target, enabled by being present, the same way
`@contractkit/plugin-typescript` turns on `server` / `sdk` / `mcp`. Turn on as many as you need:

| Target       | Output                                                                       |
| ------------ | ---------------------------------------------------------------------------- |
| `openapi`    | One OpenAPI 3.1 YAML document                                                |
| `markdown`   | One self-contained GitHub-flavored Markdown reference                        |
| `mintlify`   | A Mintlify site: MDX pages, `docs.json`, and the spec they render from       |
| `docusaurus` | A Docusaurus docs folder: Markdown pages and `_category_.json` sidebar files |

Every target's full option table is in [docs/config.md](../../docs/config.md#contractkitplugin-docs).
The sections below cover the two multi-page targets.

## Mintlify

### Options

| Field             | Type              | Description                                                                                                                            |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `baseDir`         | `string`          | Docs root, relative to `rootDir`. Default: `docs`                                                                                      |
| `apiDir`          | `string`          | Endpoint page directory under `baseDir`. Default: `api-reference`                                                                      |
| `modelsDir`       | `string`          | Model page directory under `baseDir`. Default: `<apiDir>/models`                                                                       |
| `openapi`         | `object`          | Spec settings: `output`, `info`, `servers`, `security`, `securitySchemes`, as the `openapi` target takes them. Default: `openapi.yaml` |
| `tab`             | `string \| false` | Generated tab title. `false` puts the groups under `navigation.groups` instead. Default: `API Reference`                               |
| `modelPages`      | `boolean`         | Emit a page per documented model. Default: `true`                                                                                      |
| `includeInternal` | `boolean`         | Whether to document `internal` operations. Default: `false`                                                                            |
| `docs`            | `object`          | Merged over the generated `docs.json`: `name`, `theme`, `colors`, `logo`, extra navigation tabs or groups                              |

### Output

```
docs/
├── docs.json                              site config + navigation (regenerated)
├── openapi.yaml                           the spec every page renders from
├── index.mdx                              starter landing page (written once, then yours)
└── api-reference/
    ├── <area>/<endpoint>.mdx              one per documented operation
    └── models/
        ├── <model>.mdx                    models from files with no area
        └── <area>/<model>.mdx             models grouped by area
```

Pages are frontmatter only:

```
---
title: "Create a payment"
sidebarTitle: "Create a payment"
openapi: "/openapi.yaml POST /payments"
---
```

Mintlify reads that reference and renders the parameters, request and response schemas, and the
interactive playground from the spec. The contract's description is already the operation's
`description` there, so writing it into the page body too would only print it twice. The empty body
is where your own prose goes if you take a page over.

## Docusaurus

Emits a folder that drops into a stock `@docusaurus/preset-classic` `docs/` directory. Unlike the
Mintlify pages, these carry their whole body: there is no spec for Docusaurus to render from, so
each page holds the same tables and prose the `markdown` target writes into one file.

```json
"@contractkit/plugin-docs": {
    "docusaurus": { "baseDir": "site/docs", "label": "API Reference" }
}
```

### Options

| Field             | Type      | Description                                                                   |
| ----------------- | --------- | ----------------------------------------------------------------------------- |
| `baseDir`         | `string`  | The site's docs directory, relative to `rootDir`. Default: `docs`             |
| `apiDir`          | `string`  | Endpoint page directory under `baseDir`. Default: `api-reference`             |
| `modelsDir`       | `string`  | Model page directory under `baseDir`. Default: `<apiDir>/models`              |
| `label`           | `string`  | Sidebar label for the generated category. Default: `API Reference`            |
| `position`        | `number`  | `sidebar_position` for that category. Unset leaves the ordering to Docusaurus |
| `modelPages`      | `boolean` | Emit a page per documented model. Default: `true`                             |
| `includeInternal` | `boolean` | Whether to document `internal` operations. Default: `false`                   |

### Output

```
site/docs/api-reference/
├── _category_.json                        sidebar label and position for the section
├── index.md                               starter landing page (written once, then yours)
├── <area>/
│   ├── _category_.json                    one per endpoint group
│   └── <endpoint>.md                      one per documented operation
└── models/
    ├── _category_.json
    ├── <model>.md                         models from files with no area
    └── <area>/<model>.md                  models grouped by area
```

Nothing needs installing or configuring on the site: the default autogenerated sidebar picks the
folder up. In a hand-written sidebar, include it with
`{ type: 'autogenerated', dirName: 'api-reference' }`.

### Notes

- **Every page opts into CommonMark** with the `mdx.format: md` frontmatter. Docusaurus parses
  `.md` as MDX by default, which would reject the `<details>` blocks, the `<br>` inside table
  cells, and any unescaped `{` in a description. The opt-in is per file, so your site needs no
  `markdown.format` setting and your own MDX pages are unaffected.
- **Model references are relative file links** (`../models/billing/payment.md`), which Docusaurus
  resolves at build time and fails the build on if one breaks. A model with no page — with
  `modelPages: false`, or a reference the contracts do not define — renders as plain code instead.
- **Every generated category carries an explicit `link`.** Docusaurus otherwise promotes any doc
  named `index`, `readme`, or the same as its folder into the category's landing page and drops it
  from the sidebar, which would silently lose a model named `Models`. The section's own category is
  the deliberate exception, so `index.md` becomes its landing page.
- **`index.md` is the only user-owned file.** It is emitted write-once, so it is never overwritten
  and never removed by orphan cleanup.
- **Keep the `markdown` target's output outside this `baseDir`**, for the same reason as with
  Mintlify: Docusaurus would treat that file as another doc page.
- **A slug that starts with digits and a separator loses them.** Docusaurus reads a `2-fa` prefix
  as a sort key, so an endpoint named `2FA` becomes the doc `fa` at position 2. Rename it with
  `sdk:` if that matters.

## How things are named

These apply to both multi-page targets.

- **Groups** come from the source file's `area`, for models as well as endpoints. Endpoints with
  no area land in a single `Endpoints` group, listed first. Models with an area become a nested
  subgroup inside `Models`, under `<modelsDir>/<area>/`; area-less models sit directly in `Models`,
  so a project with no areas keeps a flat list.
- **Page titles** follow `name:`, then the description, then the service method, then the HTTP verb
  and path. A description beats a method name because `PaymentService.create` alone gives "Create",
  where the description gives "Create a payment".
- **Page slugs** follow `sdk:`, then `name:`, then the service method, then the HTTP method and
  path. Collisions within a group get a numeric suffix.

## Mintlify notes

- **`docs.json` is regenerated on every build**, so navigation cannot drift when an endpoint is
  added or removed. Keep site settings and hand-written pages in the `docs` option: its keys
  override the generated defaults, your `navigation.tabs` (or `groups`) are kept with the generated
  API reference appended after them, and other `navigation` keys such as `global` pass through.
- **`index.mdx` is the only user-owned file.** It is emitted write-once, so it is never overwritten
  and never removed by orphan cleanup. Everything else is generated and will be rewritten.
- **Only models an operation can reach get a page**, matching the schemas the spec contains.
- **Keep the `markdown` output out of the Mintlify docs folder.** Mintlify parses every markdown
  file under its `baseDir` as MDX, and the Markdown reference is GitHub-flavored: a description
  containing something like `/documents/<id>/content` is valid there and a parse error in MDX. Give
  the `markdown` target its own `baseDir`.
- **A `baseDir` or `output` inside the `openapi` option does not move the spec out of the docs
  folder.** The plugin owns that path, because every page's frontmatter points at it.

## Programmatic use

```ts
import { createDocsPlugin } from '@contractkit/plugin-docs';

const plugin = createDocsPlugin({ docusaurus: { baseDir: 'site/docs' } }, process.cwd());
```

## License

MIT
