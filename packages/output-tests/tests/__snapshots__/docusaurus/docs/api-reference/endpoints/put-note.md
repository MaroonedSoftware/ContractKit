---
title: "Replace a note"
sidebar_label: "Replace a note"
sidebar_position: 4
mdx:
    format: "md"
---

**`PUT`** `/notes/{body}`

:::note
SDK method: `putNote`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `body` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [Note](../models/note.md) object.

## Response

`200 OK` — Returns a [Note](../models/note.md) object.
