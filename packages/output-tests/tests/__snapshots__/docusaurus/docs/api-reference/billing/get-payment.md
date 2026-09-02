---
title: "Fetch one payment"
sidebar_label: "Fetch one payment"
sidebar_position: 3
mdx:
    format: "md"
---

**`GET`** `/payments/{paymentId}`

:::note
SDK method: `getPayment`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [Payment](../models/billing/payment.md) object.

`404 Not Found`
