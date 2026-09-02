---
title: "Upload a receipt image"
sidebar_label: "Upload a receipt image"
sidebar_position: 6
mdx:
    format: "md"
---

**`POST`** `/payments/{paymentId}/receipt`

:::note
SDK method: `uploadReceipt`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `paymentId` | `string` | Yes | Path parameter. |

</details>

## Request body (`multipart/form-data`)

Accepts a [UploadReceiptForm](../models/billing/upload-receipt-form.md) object.

## Response

`200 OK` — Returns a [Payment](../models/billing/payment.md) object.
