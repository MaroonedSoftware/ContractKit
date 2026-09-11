---
title: "Save a scoped search"
sidebar_label: "Save a scoped search"
sidebar_position: 14
mdx:
    format: "md"
---

**`POST`** `/payments/by-date/scoped`

:::note
SDK method: `saveScopedSearch`
:::

## Request body (`application/json`)

Accepts `PaymentScope & SnakeFilter`.

## Response

`200 OK` — Returns a [SavedSearch](../models/billing/saved-search.md) object.
