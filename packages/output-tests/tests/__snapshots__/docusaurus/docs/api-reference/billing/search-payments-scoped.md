---
title: "Search payments with a snake_case filter extended inline"
sidebar_label: "Search payments with a snake_case filter extended inline"
sidebar_position: 13
mdx:
    format: "md"
---

**`GET`** `/payments/by-date/scoped`

:::note
SDK method: `searchPaymentsScoped`
:::

## Attributes

<details>
<summary>Attributes (5)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `q` | `string` | Yes |  |
| `fromDate` | `string` | No |  |
| `tagIds` | `string[]` | No |  |
| `tenantId` | `string` | No |  |
| `xTrace` | `string` | No |  |

</details>

## Response

`200 OK` — Returns `SnakeFilter & { q: string }`.
