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
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `x-tenant` | `string` | Yes |  |
| `ids` | `string[]` | No |  |
| `since` | `string` | No |  |
| `status` | `'pending' \| 'completed' \| 'failed'` | No |  |
| `xCorrelationId` | `string` | No |  |

</details>

## Response

`200 OK` — Returns a list of [Payment](../models/billing/payment.md) objects.
