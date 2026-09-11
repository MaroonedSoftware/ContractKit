---
title: "One status with two content types and response headers, so the headers are read before the mime dispatch"
sidebar_label: "One status with two content types and response headers, so the headers are read before the mime dispatch"
sidebar_position: 7
mdx:
    format: "md"
---

**`GET`** `/folders/{folder-id}/export`

:::note
SDK method: `exportFolder`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` `application/json` — Returns a [Folder](../models/kitchen/folder.md) object.

`200` `text/csv` — Returns `string`.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `x-export-id` | `string` *(required)* |  |
| `x-rows` | `number` |  |
