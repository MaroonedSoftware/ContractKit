---
title: "Fetch an invoice"
sidebar_label: "Fetch an invoice"
sidebar_position: 1
mdx:
    format: "md"
---

**`GET`** `/invoices/{invoice-id}`

:::note
SDK method: `getInvoice`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `invoice-id` | `string` | Yes | Path parameter. |

</details>

## Response

`200 OK` — Returns a [Invoice](../models/invoice.md) object.

`404 Not Found`
