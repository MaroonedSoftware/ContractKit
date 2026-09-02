---
title: "Look up a refund by its originating payment"
sidebar_label: "Look up a refund by its originating payment"
sidebar_position: 7
mdx:
    format: "md"
---

:::warning[Deprecated]
This endpoint is deprecated and may be removed in a future version.
:::

**`GET`** `/refunds/{paymentId}`

:::note
SDK method: `getRefund`
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
