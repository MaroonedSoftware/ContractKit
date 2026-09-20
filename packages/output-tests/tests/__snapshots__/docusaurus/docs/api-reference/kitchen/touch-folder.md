---
title: "The one verb with no HttpMethod static of its own on every C# target framework"
sidebar_label: "The one verb with no HttpMethod static of its own on every C# target framework"
sidebar_position: 3
mdx:
    format: "md"
---

**`PATCH`** `/folders/{folder-id}`

:::note
SDK method: `touchFolder`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [Named](../models/kitchen/named.md) object.

## Response

`200 OK` — Returns a [Folder](../models/kitchen/folder.md) object.
