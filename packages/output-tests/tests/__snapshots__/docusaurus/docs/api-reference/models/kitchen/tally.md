---
title: "Tally"
sidebar_position: 3
mdx:
    format: "md"
---

> A service that adds an enum member must not break an older client: an SDK reads a value it does
> not know as unknown wherever an enum sits, and a plain string beside an enum in a union still gets
> one the enum does not know

<details>
<summary>Attributes (6)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `rating` | `Rating` | Yes |  |
| `status` | `'open' \| 'closed'` | No |  |
| `maybe` | `Rating` | Yes | *nullable* |
| `many` | `Rating[]` | Yes |  |
| `either` | `'open' \| 'closed' \| string` | Yes |  |
| `fallback` | `'open' \| 'closed' \| number` | Yes |  |

</details>
