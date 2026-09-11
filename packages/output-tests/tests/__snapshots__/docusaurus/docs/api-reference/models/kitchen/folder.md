---
title: "Folder"
sidebar_position: 2
mdx:
    format: "md"
---

> Self recursion through lazy(), mutual recursion through Doc, every container, both union
> forms, every scalar, and field names that are keywords in the target languages

<details>
<summary>Attributes (22)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes |  |
| `class` | `string` | Yes |  |
| `default` | `string` | No |  |
| `rating` | `Rating` | No | *default: `neutral`* |
| `parent` | `Folder` | No |  |
| `readme` | `Doc` | No |  |
| `children` | `Folder[]` | Yes |  |
| `byName` | `Record<string, Folder>` | No |  |
| `span` | `[number, number]` | No |  |
| `stamped` | `[string, string, boolean]` | No |  |
| `label` | `string \| number` | Yes |  |
| `pinned` | `Doc \| Folder` | Yes | *nullable* |
| `instrument` | `Card \| Bank` | No |  |
| `origin` | `{ x: number; y: number }` | No |  |
| `size` | `bigint` | Yes |  |
| `price` | `Decimal` | Yes |  |
| `day` | `string` | No |  |
| `at` | `string` | No |  |
| `ttl` | `string` | No |  |
| `blob` | `Blob` | No |  |
| `extra` | `unknown` | No |  |
| `raw` | `JsonValue` | No |  |

</details>
