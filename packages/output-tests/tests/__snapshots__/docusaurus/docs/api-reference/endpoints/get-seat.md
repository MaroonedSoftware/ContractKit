---
title: "Fetch one seat"
sidebar_label: "Fetch one seat"
sidebar_position: 2
mdx:
    format: "md"
---

**`GET`** `/seats/{seatId}`

:::note
SDK method: `getSeat`
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `seatId` | `string` | Yes | Path parameter. |
| `from` | `string` | No |  |
| `pageSize` | `number` | No |  |

</details>

## Response

`200 OK` — Returns a [Seat](../models/seat.md) object.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `from` | `string` |  |
