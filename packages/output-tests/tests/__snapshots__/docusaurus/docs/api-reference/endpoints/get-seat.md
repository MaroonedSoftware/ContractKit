---
title: "Fetch one seat"
sidebar_label: "Fetch one seat"
sidebar_position: 2
mdx:
    format: "md"
---

**`GET`** `/seats/{class}`

:::note
SDK method: `getSeat`
:::

## Attributes

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `class` | `string` | Yes | Path parameter. |
| `from` | `string` | No |  |
| `from` | `string` | No |  |
| `in` | `string` | No |  |
| `pageSize` | `number` | No |  |

</details>

## Response

`200 OK` — Returns a [Seat](../models/seat.md) object.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `from` | `string` |  |
