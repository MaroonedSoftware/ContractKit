---
title: "ChatDone"
sidebar_position: 2
mdx:
    format: "md"
---

> The reply is complete

<details>
<summary>Attributes (2)</summary>

| Attribute | Type | Required | Description |
| --- | --- | --- | --- |
| `type` | `'done'` | Yes |  |
| `tokens` | `bigint` | Yes | Total tokens, a bigint so each event goes through the reviver. *sent as a digit string, "123" or "123n"* |

</details>
