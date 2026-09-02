# @contractkit/plugin-docs

> ContractKit's documentation site generator. Turns `.ck` contract and operation files into a
> deployable [Mintlify](https://mintlify.com) docs folder: an OpenAPI spec, one MDX page per
> endpoint and per model, and the `docs.json` that navigates them.

Loaded by `@contractkit/cli` through `contractkit.config.json`. It consumes the AST produced by
`@contractkit/core` and builds its OpenAPI document with `@contractkit/plugin-openapi`.

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
```

## Options

| Field             | Type              | Description                                                                                                                                     |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`          | `string`          | Documentation platform. Only `mintlify` is supported. Default: `mintlify`                                                                       |
| `baseDir`         | `string`          | Docs root, relative to `rootDir`. Default: `docs`                                                                                               |
| `apiDir`          | `string`          | Endpoint page directory under `baseDir`. Default: `api-reference`                                                                               |
| `modelsDir`       | `string`          | Model page directory under `baseDir`. Default: `<apiDir>/models`                                                                                |
| `openapi`         | `object`          | Spec settings: `output`, `info`, `servers`, `security`, `securitySchemes`, as `@contractkit/plugin-openapi` takes them. Default: `openapi.yaml` |
| `tab`             | `string \| false` | Generated tab title. `false` puts the groups under `navigation.groups` instead. Default: `API Reference`                                        |
| `modelPages`      | `boolean`         | Emit a page per documented model. Default: `true`                                                                                               |
| `includeInternal` | `boolean`         | Whether to document `internal` operations. Default: `false`                                                                                     |
| `docs`            | `object`          | Merged over the generated `docs.json`: `name`, `theme`, `colors`, `logo`, extra navigation tabs or groups                                       |

## Output

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

## How things are named

- **Groups** come from the source file's `area`, for models as well as endpoints. Endpoints with
  no area land in a single `Endpoints` group, listed first. Models with an area become a nested
  subgroup inside `Models`, under `<modelsDir>/<area>/`; area-less models sit directly in `Models`,
  so a project with no areas keeps a flat list.
- **Page titles** follow `name:`, then the description, then the service method, then the HTTP verb
  and path. A description beats a method name because `PaymentService.create` alone gives "Create",
  where the description gives "Create a payment".
- **Page slugs** follow `sdk:`, then `name:`, then the service method, then the HTTP method and
  path. Collisions within a group get a numeric suffix.

## Notes

- **`docs.json` is regenerated on every build**, so navigation cannot drift when an endpoint is
  added or removed. Keep site settings and hand-written pages in the `docs` option: its keys
  override the generated defaults, your `navigation.tabs` (or `groups`) are kept with the generated
  API reference appended after them, and other `navigation` keys such as `global` pass through.
- **`index.mdx` is the only user-owned file.** It is emitted write-once, so it is never overwritten
  and never removed by orphan cleanup. Everything else is generated and will be rewritten.
- **Only models an operation can reach get a page**, matching the schemas the spec contains.
- **A `baseDir` or `output` inside the `openapi` option does not move the spec out of the docs
  folder.** The plugin owns that path, because every page's frontmatter points at it.

## Programmatic use

```ts
import { createDocsPlugin } from '@contractkit/plugin-docs';

const plugin = createDocsPlugin({ target: 'mintlify', baseDir: 'docs' }, process.cwd());
```

## License

MIT
