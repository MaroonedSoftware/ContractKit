---
title: "An enum query parameter, sent by its wire spelling and never as the unknown member"
sidebar_label: "An enum query parameter, sent by its wire spelling and never as the unknown member"
sidebar_position: 9
mdx:
    format: "md"
---

**`GET`** `/tallies`

:::note
SDK method: `listTallies`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `rating` | `Rating` | No |  |

</details>

## Response

`200 OK` — Returns a list of [Tally](../models/kitchen/tally.md) objects.
