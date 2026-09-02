---
title: "List payments"
sidebar_label: "List payments"
sidebar_position: 2
mdx:
    format: "md"
---

**`GET`** `/payments`

:::note
SDK method: `listPayments`
:::

## Attributes

<details>
<summary>Attributes (4)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `cursor` | `string` | Yes |  |
| `x-tenant` | `string` | Yes |  |
| `api-key` | `string` | No |  |
| `limit` | `number` | No |  |

</details>

## Response

`200 OK` — Returns a list of [Payment](../models/billing/payment.md) objects.
