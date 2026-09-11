---
title: "Several statuses, and two content types on one of them"
sidebar_label: "Several statuses, and two content types on one of them"
sidebar_position: 1
mdx:
    format: "md"
---

**`GET`** `/folders/{folder-id}`

:::note
SDK method: `getFolder`
:::

## Attributes

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |
| `x-trace` | `string` | Yes |  |
| `depth` | `number` | No |  |
| `tags` | `string[]` | No |  |
| `x-opt` | `number` | No |  |

</details>

## Response

`200 OK` `application/json` — Returns a [Folder](../models/kitchen/folder.md) object.

`200` `text/plain` — Returns `string`.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `x-count` | `number` *(required)* |  |
| `x-when` | `string` |  |
| `x-seq` | `bigint` |  |

`204 No Content`

`404 Not Found` — Returns a [Shared](../models/kitchen/shared.md) object.
