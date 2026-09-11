---
title: "Search payments with a filter model"
sidebar_label: "Search payments with a filter model"
sidebar_position: 3
mdx:
    format: "md"
---

**`GET`** `/payments/search`

:::note
SDK method: `searchPayments`
:::

## Attributes

<details>
<summary>Attributes (3)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `x-tenant` | `string` | Yes |  |
| `since` | `string` | No |  |
| `status` | `'pending' \| 'completed' \| 'failed'` | No |  |

</details>

## Response

`200 OK` — Returns a list of [Payment](../models/billing/payment.md) objects.
