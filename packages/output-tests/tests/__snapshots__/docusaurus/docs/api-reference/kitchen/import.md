---
title: "A method name that is a keyword in the target languages"
sidebar_label: "A method name that is a keyword in the target languages"
sidebar_position: 2
mdx:
    format: "md"
---

**`PUT`** `/folders/{folder-id}`

:::note
SDK method: `import`
:::

## Attributes

<details>
<summary>Attributes (1)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `folder-id` | `string` | Yes | Path parameter. |

</details>

## Request body (`application/json`)

Accepts a [Shared](../models/kitchen/shared.md) object.

## Response

`200 OK` — Returns a [Instrument](../models/kitchen/instrument.md) object.
