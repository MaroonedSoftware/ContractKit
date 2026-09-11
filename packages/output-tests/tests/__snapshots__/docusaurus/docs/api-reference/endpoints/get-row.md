---
title: "Fetch a row by its seat class"
sidebar_label: "Fetch a row by its seat class"
sidebar_position: 3
mdx:
    format: "md"
---

**`GET`** `/rows/{class}`

:::note
SDK method: `getRow`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `class` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [Seat](../models/seat.md) object.
