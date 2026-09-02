---
title: "Store a credential"
sidebar_label: "Store a credential"
sidebar_position: 8
mdx:
    format: "md"
---

**`POST`** `/credentials`

:::note
SDK method: `createCredential`
:::

## Request body (`application/json`)

Accepts a [AdminCredential](../models/billing/admin-credential.md) object.

## Response

`200 OK` — Returns a [Credential](../models/billing/credential.md) object.
