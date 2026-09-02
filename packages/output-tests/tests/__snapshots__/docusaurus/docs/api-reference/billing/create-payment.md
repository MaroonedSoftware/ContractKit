---
title: "Create a payment"
sidebar_label: "Create a payment"
sidebar_position: 1
mdx:
    format: "md"
---

**`POST`** `/payments`

:::note
SDK method: `createPayment`
:::

## Request body (`application/json`)

Accepts a [Payment](../models/billing/payment.md) object.

## Response

`200 OK` — Returns a [Payment](../models/billing/payment.md) object.

Response headers:

| Header | Type | Description |
| ------ | ---- | ----------- |
| `x-request-id` | `string` *(required)* |  |
| `x-ratelimit-remaining` | `number` *(required)* |  |
| `x-cache-hit` | `boolean` |  |
| `x-expires-after` | `string` |  |

`400 Bad Request`
