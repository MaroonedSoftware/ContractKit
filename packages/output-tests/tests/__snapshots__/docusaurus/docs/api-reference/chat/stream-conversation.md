---
title: "Stream"
sidebar_label: "Stream"
sidebar_position: 1
mdx:
    format: "md"
---

**`GET`** `/conversations/{id}/stream`

:::note
SDK method: `streamConversation`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [ChatStreamEvent](../models/chat/chat-stream-event.md) object.

`404 Not Found`
