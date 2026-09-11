---
title: "Create several payments at once"
sidebar_label: "Create several payments at once"
sidebar_position: 3
mdx:
    format: "md"
---

**`POST`** `/payments/batch`

:::note
SDK method: `createPayments`
:::

## Request body (`application/json`)

Accepts a list of [Payment](../models/billing/payment.md) objects.

## Response

`200 OK` — Returns a list of [Payment](../models/billing/payment.md) objects.
