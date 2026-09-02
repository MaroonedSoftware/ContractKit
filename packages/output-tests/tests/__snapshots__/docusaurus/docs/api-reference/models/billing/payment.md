---
title: "Payment"
sidebar_position: 1
mdx:
    format: "md"
---

> A customer payment

<details>
<summary>Attributes (7)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | `string` | Yes | *read-only* |
| `amount` | `number` | Yes |  |
| `unitPrice` | `Decimal` | Yes |  |
| `quantity` | `bigint` | Yes |  |
| `createdAt` | `string` | Yes |  |
| `processingTime` | `string` | No |  |
| `status` | `'pending' \| 'completed' \| 'failed'` | Yes | *default: `pending`* |

</details>
